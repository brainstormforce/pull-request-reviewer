const { warning, info } = require("@actions/core");
const { OpenAI } = require('openai');
const core = require("@actions/core");
class AiHelper {
    prDetails;

    async checkCommentResolved(patch, commentText) {


        const userPrompt = `
                Code snippet:
                
                ${patch}
                
                Review Comment: 
                
                ${commentText}
                `;


        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: "system", content: `
                    Review a pull request (PR) diff and accompanying comment to determine if the comment has been resolved.
                    
                    Ensure that you carefully analyze the provided PR diff and the associated comment, considering whether any changes made address the concerns or requirements specified in the comment. Pay attention to code modifications, added features, or explanations that align the PR with the comment's intentions.
                    
                    # Steps
                    
                    1. **Understand the Comment**: Read the comment to understand the concern or suggestion it provides. Identify the specific parts of the code or logic it pertains to.
                    2. **Analyze the PR Diff**: Examine the PR diff to identify changes that have been implemented. Look for specific lines, functions, or logic that relate to the comment.
                    3. **Compare with Comment**: Determine if the changes in the PR diff adequately address the comment. Consider if the solution aligns with the comment’s objectives.
                    4. **Reasoning**: Provide a brief explanation of why the comment is considered resolved or unresolved, detailing how the changes align or fail to align with the comment's specifications.
                    5. **Conclusion**: Clearly state whether the comment is resolved or not.
                ` },
                { role: "user", content: userPrompt },
            ],
            response_format: {
                "type": "json_schema",
                "json_schema": {
                    "name": "comment_resolutions",
                    "strict": true,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "status": {
                                "type": "string",
                                "description": "The status of the comment resolution. Indicate whether the comment has been resolved or not. If resolved, appriciate. If unresolved, specify the reasons why the comment remains unaddressed.",
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

    constructor(apiKey, githubHelper, prDetails) {
        this.openai = new OpenAI({ apiKey });
        this.githubHelper = githubHelper;
        this.prDetails = prDetails;

        this.fileCache = {};
    }



    async initCodeReviewAssistant() {

        let instructions = `
            You are an expert AI responsible for reviewing GitHub Pull Requests (PRs) with a focus on code quality, functionality, and alignment with provided JIRA tasks.
            You will be given a PR title, description, and possibly JIRA task details for context. Your goal is to analyze the code changes and suggest improvements or raise concerns based on the following guidelines:
            
            Actions:
            - Code Comments: Use 'addReviewCommentToFileLine' to leave specific comments on lines of code that contain mistakes or potential issues. Pay close attention to line numbers.
            - Request File Content: Use 'getFileContent' when necessary to gather more context for better analysis.
            - Final PR Judgment: Use updatePrStatus to either:
                 - APPROVE if the PR is clean, or
                 - REQUEST CHANGES if issues are found.
            
            Focus Areas:
            - Prioritize new code that starts with +.
            - Suggest code refactoring or optimizations when appropriate using backticks (e.g., \`optimizeFunction()\`).
            - Validate functionality against the JIRA task and ensure that all requirements are met.
            - Look for logical errors, security vulnerabilities, and typos.
            - Avoid repeated comments for the same issue; instead, highlight other critical mistakes.
            - Ignore code styling issues but ensure code standard consistency.
            - Always be concise and simply respond with "LGTM" if the code looks good with no major issues.
            
            Warnings:
            - Be mindful that line numbers in the files start from 1.
            - Focus on actionable feedback without suggesting vague improvements.
            
            More context:
            
            PR Title:
            \`\`\`
        ${this.prDetails.prTitle}
             \`\`\`
             
             PR Description:
            \`\`\`
        ${this.prDetails.prDescription}
            \`\`\`
            `;

        if (this.prDetails.jiratTaskTitle || this.prDetails.jiraTaskDescription) {
            instructions += `
            JIRA Task ID: 
            
            \`\`\`
            ${this.prDetails.jiratTaskTitle}
            \`\`\`
            
            JIRA Task Description: 
            
            \`\`\`
            ${this.prDetails.jiraTaskDescription}
            \`\`\`
            `;
        }


        this.assistant = await this.openai.beta.assistants.create({
            name: "BSF - AI Code Reviewer",
            instructions: instructions
,           model: "gpt-4o-mini",
            tool_resources: {
                "code_interpreter": {
                    "file_ids": []
                }
            },
            tools:  [
                {
                    "type": "code_interpreter"
                },
                {
                    "type": "function",
                    "function": {
                        "name": "getFileContent",
                        "description": "Retrieves the file content to better understand the provided changes",
                        "parameters": {
                            "type": "object",
                            "required": [
                                "pathToFile",
                                "startLineNumber",
                                "endLineNumber"
                            ],
                            "properties": {
                                "pathToFile": {
                                    "type": "string",
                                    "description": "The fully qualified path to the file."
                                },
                                "endLineNumber": {
                                    "type": "integer",
                                    "description": "The ending line number of the code segment of interest."
                                },
                                "startLineNumber": {
                                    "type": "integer",
                                    "description": "The starting line number of the code segment of interest."
                                }
                            }
                        },
                        "strict": false
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "addReviewCommentToFileLine",
                        "description": "Adds an AI-generated review comment to the specified line in a file. DO NOT provide 'ensure', 'verify' etc like reviews.",
                        "parameters": {
                            "type": "object",
                            "required": [
                                "side",
                                "lineNumber",
                                "fileName",
                                "foundIssueDescription"
                            ],
                            "properties": {
                                "side": {
                                    "type": "string",
                                    "description": "In a split diff view, the side of the diff that the pull request's changes appear on. Can be LEFT or RIGHT. Use LEFT for deletions that appear in red. Use RIGHT for additions that appear in green or unchanged lines that appear in white and are shown for context. For a multi-line comment, side represents whether the last line of the comment range is a deletion or addition. "
                                },
                                "fileName": {
                                    "type": "string",
                                    "description": "The relative path to the file."
                                },
                                "lineNumber": {
                                    "type": "integer",
                                    "description": "The line number in the file where the issue was found. The line of the blob in the pull request diff that the comment applies to. For a multi-line comment, the last line of the range that your comment applies to."
                                },
                                "foundIssueDescription": {
                                    "type": "string",
                                    "description": "Description of the issue found."
                                }
                            }
                        },
                        "strict": false
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "updatePrStatus",
                        "description": "Consider all above provided review comments. If no actionable review provided then mark event_type as APPROVE",
                        "parameters": {
                            "type": "object",
                            "required": [
                                "event",
                                "body"
                            ],
                            "properties": {
                                "event": {
                                    "type": "string",
                                    "description": "The event indicating the nature of the change request.",
                                    "enum": [
                                        "APPROVE",
                                        "REQUEST_CHANGES",
                                        "COMMENT"
                                    ]
                                },
                                "body": {
                                    "type": "string",
                                    "description": "Provide final summary review about PR in 50-100 words"
                                }
                            },
                            "additionalProperties": false
                        },
                        "strict": true
                    }
                }
            ]
        });
    }

    async getFileContent(args) {
        const { pathToFile, startLineNumber, endLineNumber } = args;
        const span = 20;

        let content = '';
        if (pathToFile in this.fileCache) {
            content = this.fileCache[pathToFile];
        }
        else {
            content = await this.fileContentGetter(pathToFile);
        }

       // Extract the lines from content from start and end line
        const lines = content.split("\n");
        const start = Math.max(0, startLineNumber - span);
        const end = Math.min(lines.length, endLineNumber + span);
        content = lines.slice(start, end).join("\n");

        core.info('----------- File Content After extraction -----------');
        core.info(content);
        core.info("----------------------------");


        return content;
    }

    async updateReviewPrStatus(args) {

        core.info('----------- PR Status Update Requested -----------');
        core.info(`Event: ${args.event}`);
        core.info(`Body: ${args.body}`);
        core.info('---------------------------------------------');

        const { event, body } = args;
        try {
            await this.prStatusUpdater(event, body);
            return "The PR status has been updated.";
        }
        catch (error) {
            return `There is an error in the 'updateReviewPrStatus' usage! Error message:\n${JSON.stringify(error)}`
        }
    }

    async addReviewCommentToFileLine(args) {
        const { fileName, lineNumber, foundIssueDescription, side } = args;
        try {
            await this.fileCommentator(foundIssueDescription, fileName, lineNumber, side);
            return "The note has been published.";
        }
        catch (error) {
            return `There is an error in the 'addReviewCommentToFileLine' usage! Error message:\n${JSON.stringify(error)}`
        }
    }

    async executeCodeReview(changedFiles, existingPrComments, githubHelper) {
        const simpleChangedFiles = changedFiles.map(file => ({
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
            core.info('processing file: ' + file.filename);

            // Get the comments in this file
            const comments = existingPrComments.filter(comment => comment.path === file.filename);

            // Loop to each comment to check if it is resolved
            for (const comment of comments) {
                const resolved = await this.checkCommentResolved(file.patch, comment.body);

                core.info('----------- Comment Resolved -----------');
                core.info(`Resolved: ${resolved.status}`);
                core.info('----------------------------');

                await githubHelper.updateReviewComment(comment.id, resolved.status);
            }

            process.exit(0)
            const response = await this.reviewFile(file);
            if (response.choices[0].message.content) {
                prComments.push(JSON.parse(response.choices[0].message.content).comments);
            }

        }

        core.info("----------- PR Comments -----------");
        core.info(JSON.stringify(prComments, null, 2));
        core.info("----------------------------");

        process.exit(0)



    }

    async reviewFile(file) {

        const systemPrompt = `
            Do the code review of the given pull request diff which is incomplete code fragment meaning it is just a map of added and removed lines in the file.
            So analyse what is removed and what is added and provide the review comments.
                        
            First, understand the Diff format to improve your review process. Focus on identifying which code has been removed and what has been newly added, and use this context exclusively for your review.     -----
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
            Meaning of this diff is - The diff replaces a = a + 1 with a++ for brevity, while the notation @@ -14,7 +14,7 @@ shows that this is the only change within a 7-line block starting at line 14.
            -----
            
            ## Focus area
            - Analyze the code diff to understand what changes have been made.
            - Focus on areas such as code style consistency, efficiency, readability, and correctness.
            - Identify any potential bugs or logic errors.
            - Suggest improvements for variable naming, code structure, and documentation.
            - Ensure adherence to best practices and relevant coding standards.
            
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
                                        "line": {
                                            "type": "integer",
                                            "description": "The line number in the code snippet where the comment applies."
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
                                                    "description": "Describes the specific issue or area in the code that needs attention. It should clearly state what the reviewer is pointing out, whether it’s a security concern, performance bottleneck, naming inconsistency, or anything else that requires a change."
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

    async executeCodeReviewImpl(simpleChangedFiles) {
        this.message = await this.openai.beta.threads.messages.create(
            this.thread.id,
            {
                role: "user",
                content: `
                PR diff for review:
                
               \`\`\`
                ${JSON.stringify(simpleChangedFiles)}
                \`\`\`
                `
            }
        );

        this.run = await this.openai.beta.threads.runs.createAndPoll(
            this.thread.id,
            {
                assistant_id: this.assistant.id,
            }
        );

        await this.processRun();

        const messages = await this.openai.beta.threads.messages.list(
            this.thread.id
        );

        for (const message of messages.data.reverse()) {
            console.log(`${message.role} > ${message.content[0].text.value}`);
        }
    }

    async processRun() {
        do {
            this.runStatus = await this.openai.beta.threads.runs.retrieve(this.thread.id, this.run.id);

            let tools_results = []
            if (this.runStatus.status === 'requires_action') {
                for (const toolCall of this.runStatus.required_action.submit_tool_outputs.tool_calls) {
                    let result = '';
                    let args = JSON.parse(toolCall.function.arguments);
                    if (toolCall.function.name == 'getFileContent') {
                        result = await this.getFileContent(args);
                    }
                    else if (toolCall.function.name == 'addReviewCommentToFileLine') {
                        result = await this.addReviewCommentToFileLine(args);
                    }
                    else if (toolCall.function.name == 'updatePrStatus') {
                        result = await this.updateReviewPrStatus(args);
                    }
                    else {
                        result = `Unknown tool requested: ${toolCall.function.name}`;
                    }

                    tools_results.push({ tool_call_id: toolCall.id, output: result })
                }

                await this.openai.beta.threads.runs.submitToolOutputs(this.thread.id, this.run.id, {
                    tool_outputs: tools_results,
                });
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
        } while (this.runStatus.status !== "completed");
    }
}

module.exports = AiHelper;