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
            model: this.model,
            messages: [
                { role: "system", content: 'You are an experienced software reviewer. Please verify the code snippet and determine whether the provided review has been addressed.' },
                { role: "user", content: userPrompt },
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "pull_request_review_verify",
                    strict: true,
                    schema: {
                        type: "object",
                        properties: {
                            status: {
                                type: "string",
                                description: "RESOLVED if the review comment has been addressed, UNRESOLVED if the review comment has not been addressed.",
                                enum: ["RESOLVED", "UNRESOLVED"]
                            }
                        },
                        required: ["status"],
                        additionalProperties: false
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

    constructor(apiKey, fileContentGetter, fileCommentator, prStatusUpdater) {
        this.openai = new OpenAI({ apiKey });
        this.fileContentGetter = fileContentGetter;
        this.fileCommentator = fileCommentator;
        this.prStatusUpdater = prStatusUpdater;
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


        core.info('----------- Assistant Initialization -----------');
        core.info(instructions);
        core.info('---------------------------------------------');


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

        content = `${pathToFile}\n'''\n${content.substring(Math.max(0, startLineNumber - span), endLineNumber + span)}\n'''\n`;

        core.info("----------- File Content Requested -----------");
        core.info(`Path: ${pathToFile}`);
        core.info(`Start Line: ${startLineNumber}`);
        core.info(`End Line: ${endLineNumber}`);
        core.info(content)
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

    async executeCodeReview(changedFiles) {
        const simpleChangedFiles = changedFiles.map(file => ({
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch
        }));

        await this.initCodeReviewAssistant();

        let retries = 0;
        const maxRetries = 3;
        while (retries < maxRetries) {

            this.thread = await this.openai.beta.threads.create();
            try {
                await this.executeCodeReviewImpl(simpleChangedFiles);
                break;

            } catch (error) {
                const response = await this.openai.beta.threads.del(this.thread.id);
                warning(response);

                retries++;
                if (retries >= maxRetries) {
                    warning("Max retries reached. Unable to complete code review.");
                    throw error;
                }

                warning(`Error encountered: ${error.message}; retrying...`);
                const delay = Math.pow(2, retries) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
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