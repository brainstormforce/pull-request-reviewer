// Import statements for required libraries
const core = require('@actions/core');
const github = require('@actions/github');
const parseDiff = require('parse-diff');
const axios = require('axios');
const { Octokit } = require("@octokit/rest");

// AI Class Definition
class AI {
    constructor(token, model) {
        this.token = token;
        this.model = model;
    }

    async requestReview(fileContent, diffs) {
        const prompt = this.constructPrompt(fileContent, diffs);
        try {
            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: this.model,
                messages: [{ role: "user", content: prompt }],
            }, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
            });
            return response.data.choices[0].message.content;
        } catch (error) {
            throw new Error(`AI request failed: ${error.message}`);
        }
    }

    constructPrompt(fileContent, diffs) {
        return `
        Please review the following code and provide feedback. 
        Here is the complete code:

        Code:
        ${fileContent}

        Diffs:
        ${JSON.stringify(diffs)}

        Please provide comments for any issues found in the code, and highlight specific lines if necessary.
        `;
    }
}

// Log Class for logging actions
class Log {
    static print(message, color = "white") {
        const colorCodes = {
            white: '\x1b[37m',
            green: '\x1b[32m',
            yellow: '\x1b[33m',
            red: '\x1b[31m',
            reset: '\x1b[0m',
        };
        console.log(`${colorCodes[color]}${message}${colorCodes.reset}`);
    }
}

// GitHubRepo Class for interacting with GitHub
class GitHubRepo {
    constructor(token, owner, repo, pullNumber) {
        this.token = token;
        this.owner = owner;
        this.repo = repo;
        this.pullNumber = pullNumber;
        this.client = new Octokit({ auth: this.token });
    }

    async getFiles() {
        try {
            const { data: diffData } = await this.client.pulls.get({
                owner: this.owner,
                repo: this.repo,
                pull_number: this.pullNumber,
                mediaType: { format: 'diff' },
            });

            // Assuming you want to get a list of changed files
            return diffData.files; // Adjust this based on your needs
        } catch (error) {
            console.error(`Error fetching files: ${error.message}`);
            throw error; // Re-throw to handle it in the calling function if needed
        }
    }

    async postComment(file, text, line = null) {
        const body = line ? `Line ${line}: ${text}` : text;

        try {
            await this.client.pulls.createReviewComment({
                owner: this.owner,
                repo: this.repo,
                pull_number: this.pullNumber,
                body: body,
                path: file,
                line: line,
            });
            console.log(`Posted comment on ${file}${line ? ' at line ' + line : ''}: ${text}`);
        } catch (error) {
            console.error(`Failed to post comment on ${file}${line ? ' at line ' + line : ''}: ${error.message}`);
        }
    }
}

// Main function to analyze code changes
async function run() {
    try {
        const token = core.getInput('github_token');
        const chatgpt_token = core.getInput('chatgpt_token');
        const chatgpt_model = core.getInput('chatgpt_model');
        const owner = github.context.repo.owner;
        const repo = github.context.repo.repo;
        const pull_number = github.context.issue.number;

        const githubRepo = new GitHubRepo(token, owner, repo, pull_number);
        const ai = new AI(chatgpt_token, chatgpt_model);

        // Fetch the pull request details, including the changed files
        const { data: pullRequest } = await githubRepo.client.pulls.get({
            owner,
            repo,
            pull_number,
            mediaType: { format: 'diff' }, // Get the diff format
        });

        // Assuming pullRequest.files contains the file changes
        const files = pullRequest.files || []; // Adjust this according to the actual response structure

        for (const file of files) {
            Log.print(`Checking file: ${file.filename}`, 'green');

            // Fetch the file content
            const { data: contentResponse } = await githubRepo.client.repos.getContent({
                owner,
                repo,
                path: file.filename,
            });

            const fileContent = Buffer.from(contentResponse.content, 'base64').toString('utf8');
            const diffs = parseDiff(file.patch);
            const aiResponse = await ai.requestReview(fileContent, diffs);

            if (aiResponse) {
                const linesWithComments = aiResponse.split('\n').reduce((acc, line, index) => {
                    const match = line.match(/Line (\d+): (.+)/);
                    if (match) {
                        acc.push({ line: parseInt(match[1]), text: match[2] });
                    }
                    return acc;
                }, []);

                for (const { line, text } of linesWithComments) {
                    await githubRepo.postComment(file.filename, text, line);
                }
            }
        }
    } catch (error) {
        Log.print(`Error: ${error.message}`, 'red');
        core.setFailed(error.message);
    }
}

// Run the main function
run();
