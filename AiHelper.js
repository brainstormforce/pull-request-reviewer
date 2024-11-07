const { warning, info } = require("@actions/core");
const { OpenAI } = require('openai');
const core = require("@actions/core");
class AiHelper {
    prDetails;

    constructor(apiKey, prDetails) {
        this.openai = new OpenAI({ apiKey });
        this.prDetails = prDetails;
    }

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
            model: 'gpt-4o-mini',
            messages: [
                { role: "system", content: `
                    Review a pull request (PR) diff and accompanying comment to determine if the comment has been resolved.
                    Strictly check the code changes to ensure that the comment has been addressed effectively.
                    
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

    async checkApprovalStatus(prComments) {
        const userPrompt = `
                
            PR Comments:
            ${JSON.stringify(prComments)}
        `;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: "system", content: `
                    ### PR Approval Criteria Based on Comments
                    
                    Review comments on a PR to decide on approval.
                    
                    #### Guidelines:
                    - **Not Approved**: If comments request changes for security or performance issues.
                    - **Approved**: If comments only ask for verification or measurements.
                    
                    #### Steps:
                    1. **Review Comments**: Read through PR comments.
                    2. **Identify Concerns**: Note any mentions of security or performance.
                    3. **Assess Requests**:
                       - Changes for security/performance → **Not Approved**
                       - Only verification/measurements → **Approved**

              
                ` },
                { role: "user", content: userPrompt },
            ],
            response_format: {
                "type": "json_schema",
                "json_schema": {
                    "name": "is_pull_request_approved",
                    "strict": true,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "is_approved": {
                                "type": "boolean",
                                "description": "true if PR is approved, else false"
                            }
                        },
                        "required": [
                            "is_approved"
                        ],
                        "additionalProperties": false
                    }
                }
            },
            temperature: 1,
            top_p: 1,
            max_tokens: 2000,
        });

        return JSON.parse(response.choices[0].message.content).is_approved;
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
            core.info('\n\nAnalysing file: ' + file.filename) + '🔍';

            // Get the comments in this file
            const comments = existingPrComments.filter(comment => comment.path === file.filename);

            // Loop to each comment to check if it is resolved
            for (const comment of comments) {

                let tmpCommentText = comment.body.match(/What:(.*)(?=Why:)/s)?.[1]?.trim();

                if( tmpCommentText ) {
                    tmpCommentText = 'What: ' + tmpCommentText + '\n\n';
                    tmpCommentText = tmpCommentText + 'How: ' + comment.body.match(/How:(.*)/s)?.[1]?.trim();
                } else {
                    tmpCommentText = comment.body;
                }

                if (!tmpCommentText) continue;

                const resolved = await this.checkCommentResolved(file.patch, tmpCommentText);
                if(resolved.status === 'Resolved') {
                    core.info("Comment resolved, deleting! ❎");
                    await githubHelper.deleteComment(comment.id);
                    // check comment has in_reply_to_id and delete it
                    if(comment.in_reply_to_id) {
                        core.info("Deleting parent comment! ❎");
                        await githubHelper.deleteComment(comment.in_reply_to_id);
                    }
                } else {
                    core.info("Comment not resolved, keeping! ✅");
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
                const {what, why, how} = review_comment;

                if( existingPrComments.length > 0 && this.checkSimilarComment(existingPrComments, what ) ) {
                    core.info("Comment already exists, skipping ❎");
                    continue;
                }

                await githubHelper.createReviewComment(commit_id, side, line, path, `**What:** ${what}\n\n\n**Why:** ${why}\n\n\n**How:** ${how}\n\n`);

                core.info("Comment added ✅");
            }
        }
    }

    async reviewFile(file) {

        let systemPrompt = `
        Perform a code review on a PR diff to evaluate security, performance, refactorization, and optimization.
        Analyze the diff, review additions and deletions, and provide feedback.
        
        ## Ensure that the code is reviewed with emphasis on the following key areas:
        
        - **Security**: Look for potential vulnerabilities such as SQL injection, XSS, CSRF, or insecure handling of data. Verify that proper authentication and authorization checks are implemented.
        - **Performance**: Identify any code that could impact the performance negatively. Check for resource-intensive operations, inefficient algorithms, or unnecessary complexity that could be simplified.
        - **Refactorization**: Evaluate the code for readability, maintainability, and adherence to coding standards. Suggest ways to improve the structure of the code to enhance future maintenance.
        - **Optimization**: Look for opportunities to optimize the code for speed and efficiency without sacrificing readability or security. Consider memory usage, execution time, and processing power.
        
        ## Review Steps
        
        1. **Identify Language/Framework:** Identify the programming language and framework used in the code.
        2. **Review Diff:** Analyze changes line by line, noting additions/removals.
        3. **Check Efficiency:** Spot inefficiencies and suggest improvements.
        4. **Logic & Bugs:** Find logical errors or bugs; recommend fixes.
        5. **Security:** Identify vulnerabilities and suggest mitigations.
        6 **Performance:** Detect bottlenecks; propose enhancements, use of built-in functions.
        7. .**Avoid Non Impacting** STRICTLY Avoid giving feedback on non-impacting changes like formatting, comments, ensuring code quality, etc.
        
        You can use PR title and description for more context.
        
        #PR title:
        \`\`\`
        ${this.prDetails.prTitle}
        \`\`\`
        
        #PR description:
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
                                "description": "A list of review comments that the reviewer has left on the code snippets in the pull request. Each comment should be specific, actionable, and focused on a single issue. It should also consider the developer’s perspective and provide constructive feedback that helps them understand the problem and improve their code quality.",
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
                                            "description": "The review comment that the reviewer has left on the code snippet. It should be specific, actionable, and focused on a single issue. It should also consider the developer’s perspective and provide constructive feedback that helps them understand the problem and improve their code quality.",
                                            "properties": {
                                                "what": {
                                                    "type": "string",
                                                    "description": "Describes the issue that the reviewer has identified in the code snippet. It should be specific, actionable, and focused on a single problem. It should also consider the developer’s perspective and provide constructive feedback that helps them understand the issue and improve their code quality."
                                                },
                                                "why": {
                                                    "type": "string",
                                                    "description": "Explains why the issue is important and what the reviewer hopes to achieve by addressing it. It should provide context on the problem and explain how it aligns with the project’s goals, coding standards, or best practices. It should also consider the developer’s perspective and explain the benefits of making the change."
                                                },
                                                "how": {
                                                    "type": "string",
                                                    "description": "Provides a clear and concise explanation of how to fix the issue. It can include code snippets, links to documentation, or other resources that help the developer understand the problem and implement the suggested change. It should be detailed enough to guide the developer through the process but not so prescriptive that it stifles creativity or learning. It should also consider the developer’s level of expertise and provide additional context or explanations as needed."
                                                }
                                            },
                                            "required": [
                                                "what",
                                                "why",
                                                "how"
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

    async getPrSummary(prTitle, prDiff) {
        const systemPrompt = `
            Write a clear and concise summary for a pull request to help the reviewer understand the code changes effectively.

            You will be provided with:
            - A pull request code diff
            - PR title
            
            The task is to create a summary that captures the purpose of these changes, why they are necessary, and any specific details that might help the reviewer understand the context.
            
            # Steps
            1. **Understand the Context**: Analyze the PR title and commit comments to understand the broad goal and motivation of the changes.
            2. **Summarize Code Changes**: Review the code diff briefly and identify the most important changes. Summarize the types of changes—are they bug fixes, feature additions, refactoring, improvement, or other?
            3. **Highlight Key Changes**: Note the main components or files that have been modified, and briefly describe what the changes are intended to do.
            4. **Include Justification and Risks**: Mention why these changes are needed, and if relevant, mention anything that may impact backward compatibility or notable dependencies (if present).
            5. **Ensure Reviewer Clarity**: Make sure the summary covers important points that the reviewer should not miss, such as any testing that should be done, particular areas to focus on, and anything else relevant to the review.
            
            # Output Format
            Provide a one to three paragraph summary, formatted as follows:
            - **Main Purpose**: Briefly describe the purpose and goal of the pull request.
            - **Key Changes**: Summarize the main changes made in the code, such as the files modified and the types of modifications (e.g., bug fix, new feature).
            - **Additional Notes**: Any noteworthy details that help clarify the change's impact or how it should be reviewed (e.g., performance considerations, potential side effects, special testing instructions).
            
            # Examples
            
            **Example 1:**
            
            **Main Purpose**: This pull request improves performance in the data parsing module by optimizing looping logic.
            
            **Key Changes**: 
            - Refactored the \`parseData()\` function in \`parser.py\` to a new asynchronous approach.
            - Added tests in \`test_parser.py\` to ensure the parsing results remain accurate.
            - Updated related documentation/comments for code maintainability.
            
            **Additional Notes**: 
            - Reviewers, please focus on the \`parseData()\` function changes and new test cases to verify accuracy and performance gains. 
            - Make sure to measure the performance boost on larger datasets during testing.
            
            **Example 2:**
            
            **Main Purpose**: This PR introduces a new feature allowing users to add multiple tags to their posts.
            
            **Key Changes**:
            - Modified \`post_model.py\` to add a new \`tags\` attribute supporting an array of strings.
            - Updated UI components in \`post_editor.vue\` to allow users to add and visualize multiple tags.
            - Added unit test coverage for edge cases involving tag input.
            
            **Additional Notes**: 
            - Please pay special attention to the new methods handling tag validation, and note that there may be a slight impact on database queries due to additional joins.
            
            # Notes
            - Focus on providing a concise summary that emphasizes clarity and highlights what is most important for a new reviewer.
            - Avoid highly technical language that might require deeper code familiarity unless absolutely required.`;

        const userPrompt = `
            PR Diff:
            
            \`\`\`
            ${prDiff}
            \`\`\`   
            
            PR title:
            
            \`\`\`
            ${prTitle}
            \`\`\`
            
            `;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            temperature: 1,
            top_p: 1,
            max_tokens: 2000,
        });

        return response.choices[0].message.content


    }


}

module.exports = AiHelper;