const { warning, info } = require("@actions/core");
const { OpenAI } = require('openai');
const core = require("@actions/core");
class AiHelper {

    constructor(apiKey, fileContentGetter, fileCommentator) {
        this.openai = new OpenAI({ apiKey });
        this.fileContentGetter = fileContentGetter;
        this.fileCommentator = fileCommentator;
        this.fileCache = {};
    }

    async initCodeReviewAssistant() {
        this.assistant = await this.openai.beta.assistants.create({
            name: "GPT-4.5 AI core-reviwer",
            instructions:
                "You are the smartest GPT-4.5 AI responsible for reviewing code in our company's GitHub PRs.\n" +
                "Review the user's changes for logical errors and typos.\n" +
                "- Use the 'addReviewCommentToFileLine' tool to add a note to a code snippet containing a mistake. Pay extra attention to line numbers.\n" +
                "Avoid repeating the same issue multiple times! Instead, look for other serious mistakes.\n" +
                "And a most important point - comment only if you are 100% sure! Omit possible compilation errors.\n" +
                "- Use 'getFileContent' if you need more context to verify the provided changes!\n" +
                "Warning! Lines in any file are calculated from 1. You should complete your work and provide results to the user only via functions!",
            model: "gpt-4-turbo-2024-04-09",
            tools: [
                {
                "type": "function",
                "function": {
                    "name": "getFileContent",
                    "description": "Retrieves the file content to better understand the provided changes",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "pathToFile": {
                                "type": "string",
                                "description": "The fully qualified path to the file."
                            },
                            "startLineNumber": {
                                "type": "integer",
                                "description": "The starting line number of the code segment of interest."
                            },
                            "endLineNumber": {
                                "type": "integer",
                                "description": "The ending line number of the code segment of interest."
                            }
                        },
                        "required": ["pathToFile", "startLineNumber", "endLineNumber"]
                    }
                }
            },
                {
                    "type": "function",
                    "function": {
                        "name": "addReviewCommentToFileLine",
                        "description": "Adds an AI-generated review comment to the specified line in a file.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "fileName": {
                                    "type": "string",
                                    "description": "The relative path to the file."
                                },
                                "side": {
                                    "type": "string",
                                    "description": "In a split diff view, the side of the diff that the pull request's changes appear on. Can be LEFT or RIGHT. Use LEFT for deletions that appear in red. Use RIGHT for additions that appear in green or unchanged lines that appear in white and are shown for context. For a multi-line comment, side represents whether the last line of the comment range is a deletion or addition. "
                                },
                                "lineNumber": {
                                    "type": "integer",
                                    "description": "The line number in the file where the issue was found. The line of the blob in the pull request diff that the comment applies to. For a multi-line comment, the last line of the range that your comment applies to."
                                },
                                "start_line": {
                                    "type": "integer",
                                    "description": "The start of the line range that the comment refers to. The start_line is the first line in the pull request diff that your multi-line comment applies to."
                                },
                                "start_side": {
                                    "type": "string",
                                    "description": "The side of the diff that the start of the line range that the comment refers to appears on. Can be LEFT or RIGHT."
                                },
                                "foundIssueDescription": {
                                    "type": "string",
                                    "description": "Description of the issue found."
                                },
                                "subject_type": {
                                    "type": "string",
                                    "description": "The level at which the comment is targeted.Can be one of: line, file",
                                    "enum": ["line", "file"]
                                }
                            },
                            "required": ["fileName", "foundIssueDescription"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "codeReviewDone",
                        "description": "Marks the code review as completed.",
                        "parameters": {}
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

        return `${pathToFile}\n'''\n${content.substring(startLineNumber - span, endLineNumber + span)}\n'''\n`;
    }

    async addReviewCommentToFileLine(args) {
        const { fileName, lineNumber, foundIssueDescription } = args;
        try {
            await this.fileCommentator(foundIssueDescription, fileName, lineNumber);
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

        core.info('---------------------------------');
        core.info(`SimpleChangedFiles files: ${JSON.stringify(simpleChangedFiles)}`);
        core.info('---------------------------------');

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
                content: `${JSON.stringify(simpleChangedFiles)}`
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
                    else if (toolCall.function.name == 'codeReviewDone') {
                        return;
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