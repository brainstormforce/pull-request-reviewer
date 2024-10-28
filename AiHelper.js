const { warning, info } = require("@actions/core");
const { OpenAI } = require('openai');
const core = require("@actions/core");
class AiHelper {
    prDetails;

    async checkCommentResolved(patch, commentText) {

        const userPrompt = `
            Code snippet:
            
            \`\`\`
            ${patch}
            \`\`\`
            
            Review Comment: 
            
            ${commentText}
        `;


        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: "system", content: `
                    Review a pull request (PR) diff and accompanying comment to determine if the comment has been resolved.
                    Ensure that you carefully analyze the provided PR diff and the associated comment, considering whether any changes made address the concerns or requirements specified in the comment. 

                    # Steps
                    1. **Understand the Comment**: Read the comment to understand the concern or suggestion it provides. Identify the specific parts of the code or logic it pertains to.
                    2. **Analyze the PR Diff**: Examine the PR diff to identify changes that have been implemented. Look for specific lines, functions, or logic that relate to the comment.
                    3. **Compare with Comment**: Determine if the changes in the PR diff adequately address the comment. Consider if the solution aligns with the comment’s objectives.
                    4. **Conclusion**: Clearly state whether the comment is resolved or not.
         
                ` },
                { role: "user", content: userPrompt },
            ],
            response_format: {
                "type": "json_schema",
                "json_schema": {
                    "name": "comment_resolution_status",
                    "strict": true,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "status": {
                                "type": "string",
                                "description": "The status of the comment resolution. Indicate whether the comment has been resolved or not.",
                                "enum": [
                                    "Resolved",
                                    "Unresolved"
                                ]
                            }
                        },
                        "required": [
                            "status"
                        ],
                        "additionalProperties": false
                    }
                }
            },
            temperature: 1,
            top_p: 1,
            max_tokens: 2000,
        });

        return  JSON.parse(response.choices[0].message.content);
    }

    async extractJiraTaskId(prTitle) {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: "system", content: "Extract the task ID from the given PR title. Ex. SD-123, SRT-1234 etc. Generally PR title format is: <task-id>: pr tile ex. SRT-12: Task name" },
                { role: "user", content: prTitle },
            ],
            response_format: {
                "type": "json_schema",
                "json_schema": {
                    "name": "pr_title_task_id",
                    "strict": true,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "task_id": {
                                "type": "string",
                                "description": "The extracted task ID from the pull request title."
                            }
                        },
                        "required": [
                            "task_id"
                        ],
                        "additionalProperties": false
                    }
                }
            },
            temperature: 1,
            top_p: 1,
            max_tokens: 2000,
        });

        return JSON.parse(response.choices[0].message.content).task_id;
    }

    async checkSimilarComment(prevComments, currentComment) {
        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: "system", content:
                        `
                        Determine if a given string has a semantically similar string present within below array.
                        
                        Array: 
                        
                        ${JSON.stringify(prevComments)}
                        
                        # Steps

                        1. **Input Analysis**:
                           - Identify the given target string.
                           - Collect the array of strings to compare against.
                        
                        2. **Semantic Similarity Check**:
                           - Use a semantic similarity measure to compare the target string against each string in the array.
                           - Consider linguistic similarities, synonyms, and contextual meanings in the comparison.
                        
                        3. **Result Determination**:
                           - Determine if there is at least one string in the array that is semantically similar to the target string.
                           - If found, identify and return the first or all semantically similar string(s).
                        `
                },
                { role: "user", content: currentComment },
            ],
            response_format: {
                "type": "json_schema",
                "json_schema": {
                    "name": "is_semantically_similar",
                    "strict": true,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "is_similar": {
                                "type": "boolean",
                                "description": "true if semantically similar, else false"
                            }
                        },
                        "required": [
                            "is_similar"
                        ],
                        "additionalProperties": false
                    }
                }
            },
            temperature: 1,
            top_p: 1,
            max_tokens: 2000,
        });

        return JSON.parse(response.choices[0].message.content).is_similar;
    }

    constructor(apiKey, githubHelper, prDetails) {
        this.openai = new OpenAI({ apiKey });
        this.githubHelper = githubHelper;
        this.prDetails = prDetails;

        this.fileCache = {};
    }

    async executeCodeReview(changedFiles, existingPrComments, githubHelper) {
        const simpleChangedFiles = changedFiles.map(file => ({
            blob_url: file.blob_url,
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch
        }));


        const prComments = [];
        // Loop to each file to send completion openai request
        for (const file of simpleChangedFiles) {
            core.info('\n\nprocessing file: ' + file.filename);

            // Get the comments in this file
            const comments = existingPrComments.filter(comment => comment.path === file.filename);

            // Loop to each comment to check if it is resolved
            for (const comment of comments) {

                // Check if comment body starts with Resolved - Thank you
                if(comment.body.startsWith('Resolved - Thank you')) {
                    continue;
                }

                let tmpCommentText = comment.body.match(/What:(.*)(?=Why:)/s)?.[1]?.trim();

                if( tmpCommentText ) {
                    tmpCommentText = 'What: ' + tmpCommentText + '\n\n';
                    tmpCommentText = tmpCommentText + 'How: ' + comment.body.match(/How:(.*)(?=Impact:)/s)?.[1]?.trim();
                } else {
                    tmpCommentText = comment.body;
                }

                if (!tmpCommentText) continue;

                const resolved = await this.checkCommentResolved(file.patch, tmpCommentText);
                if(resolved.status === 'Resolved') {
                    await githubHelper.updateReviewComment(comment.id, 'Resolved - Thank you :thumbsup:');
                }
            }

            const response = await this.reviewFile(file);
            if (response.choices[0].message.content) {
                prComments.push(JSON.parse(response.choices[0].message.content).comments);
            }

        }






        existingPrComments = existingPrComments.map(comment => {
           return comment.body.match(/What:(.*)(?=Why:)/s)?.[1]?.trim();
        }).filter(Boolean);






        // Loop on the prComments to add the comments to the PR
        for (const comments of prComments) {
            for (const comment of comments) {
                const {commit_id, side, line, path, review_comment} = comment;
                const {what, why, how, impact} = review_comment;
                
                if( this.checkSimilarComment(existingPrComments, what ) ) {
                    core.info("Comment already exists, skipping");
                    continue;
                }

                core.info("Creating comment");
                // await githubHelper.createReviewComment(commit_id, side, line, path, `**What:** ${what}\n\n\n**Why:** ${why}\n\n\n**How:** ${how}\n\n\n**Impact:** ${impact}\n`);
            }
        }

        process.exit(0);


    }

    async reviewFile(file) {

        let systemPrompt = `
            Do the code review of the given pull request diff which is incomplete code fragment meaning it is just a map of added and removed lines in the file.
            So analyse what is removed and what is added and provide the review comments.
                        
            First, understand the Diff format to improve your review process. 
            Focus on identifying which code has been removed and what has been newly added, and use this context exclusively for your review.     -----
            \`\`\`diff
            diff --git a/loader.php b/loader.php
            index ff652b5..f271a52 100644
            --- a/loader.php
            +++ b/loader.php
            @@ -14,7 +14,7 @@ jobs:
            -        a = a + 1
            +        a++
                       c = a + b
            
            \`\`\`
            Meaning of this diff is - The diff replaces a = a + 1 with a++ for brevity, 
            while the notation @@ -14,7 +14,7 @@ shows that this is the only change within a 7-line block starting at line 14.            
            ----- 
            
            ## Focus area
            - Analyze the code diff to understand what changes have been made.
            - Focus on areas such as code style consistency, efficiency, readability, and correctness.
            - Identify any potential bugs or logic errors.
            - Suggest improvements for variable naming, code structure, and documentation.
            - Ensure adherence to best practices and relevant coding standards.
            - Ignore extra spaces, tabs, indentation, or formatting issues.
            
            ## Steps
            
            1. **Examine the Diff:** Start by reviewing the code changes in the pull request diff.
            2. **Code Quality:** Check for readability, consistent styling, and clear syntax.
            3. **Efficiency:** Look for any inefficient algorithms or patterns and recommend optimizations.
            4. **Logic & Bugs:** Identify logical errors or bugs and suggest corrections.
            5. **Best Practices:** Ensure the code follows best practices and relevant coding standards.
            6. **Naming & Structure:** Evaluate variable names and the overall structure for clarity and simplicity.
            7. **Documentation:** Check for adequate comments and documentation explaining code functionality.
            
            You can use PR title and description for more context.
            
            PR title:
            \`\`\`
            ${this.prDetails.prTitle}
            \`\`\`
            
            PR description:
            \`\`\`
            ${this.prDetails.prDescription}
            \`\`\`    
            
            `;

        return this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {role: "system", content: systemPrompt},
                {role: "user", content: `${JSON.stringify(file)}`},
            ],
            response_format: {
                "type": "json_schema",
                "json_schema": {
                    "name": "code_review_comments",
                    "strict": true,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "comments": {
                                "type": "array",
                                "description": "A collection of review comments for specific code snippets.",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "commit_id": {
                                            "type": "string",
                                            "description": "Extract the commit_id from the blob_url. https://github.com/<owner>/<repo>/blob/<commit_id>/*"
                                        },
                                        "side": {
                                            "type": "string",
                                            "description": "The side of the diff that the pull request's changes appear on. Can be LEFT or RIGHT. Use LEFT for deletions that appear in red. Use RIGHT for additions that appear in green or unchanged lines that appear in white and are shown for context. For a multi-line comment, side represents whether the last line of the comment range is a deletion or addition."
                                        },
                                        "line": {
                                            "type": "integer",
                                            "description": "To find a specific code line in a diff, locate the base line number from the diff header (e.g., @@ -14,6 +14,6 @@), then count the lines from there to your target line."
                                        },
                                        "path": {
                                            "type": "string",
                                            "description": "The path of the file containing the code snippet."
                                        },
                                        "review_comment": {
                                            "type": "object",
                                            "description": "The review comment detailing the object, why it is commented, and how it can be improved.",
                                            "properties": {
                                                "what": {
                                                    "type": "string",
                                                    "description": "Describes the specific issue by quoting the specific code or area in the code that needs attention. It should clearly state what the reviewer is pointing out, whether it’s a security concern, performance bottleneck, naming inconsistency, or anything else that requires a change."
                                                },
                                                "why": {
                                                    "type": "string",
                                                    "description": "Why the change is recommended. It clarifies the potential issue or downside of the current implementation, giving the developer insight into the risks, limitations, or best practices they may have overlooked."
                                                },
                                                "how": {
                                                    "type": "string",
                                                    "description": "provides guidance or a specific example on how to address the issue. Generally contains the refactored code snippet with may include a brief explanation, or reference to a best practice that can help the developer implement the suggested change effectively."
                                                },
                                                "impact": {
                                                    "type": "string",
                                                    "description": "Explains the positive outcomes or benefits of making the suggested change, such as improved security, performance, readability, or maintainability. It can also highlight potential negative impacts if the change isn’t made."
                                                }
                                            },
                                            "required": [
                                                "what",
                                                "why",
                                                "how",
                                                "impact"
                                            ],
                                            "additionalProperties": false
                                        }
                                    },
                                    "required": [
                                        "commit_id",
                                        "side",
                                        "line",
                                        "path",
                                        "review_comment"
                                    ],
                                    "additionalProperties": false
                                }
                            }
                        },
                        "required": [
                            "comments"
                        ],
                        "additionalProperties": false
                    }
                }
            },
            temperature: 1,
            top_p: 1,
            max_tokens: 8000,
        });
    }



}

module.exports = AiHelper;