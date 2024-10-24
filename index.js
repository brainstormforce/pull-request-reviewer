const { Octokit } = require("@octokit/rest");
const axios = require("axios");
const { GitHub, context } = require("@actions/github");
const core = require("@actions/core");

class PullRequestReviewer {

    static extractedDiffs = [];

    constructor(githubToken, openaiApiKey, model) {
        this.octokit = new Octokit({ auth: githubToken });
        this.openaiApiKey = openaiApiKey;
        this.model = model;
        this.baseUrl = "https://api.github.com";
    }

    async reviewPullRequest(pullRequestId) {
        const owner = context.repo.owner;
        const repo = context.repo.repo;

        try {

            // List all PR files
            const { data: changedFiles } = await this.octokit.rest.pulls.listFiles({
                owner,
                repo,
                pull_number: pullRequestId,
            });

            core.info("Changed Files: " + JSON.stringify(changedFiles));
            exit(0);



            // Get PR details
            const { data: prDetails } = await this.octokit.rest.pulls.get({
                owner,
                repo,
                pull_number: pullRequestId,
            });

            // Fetch the PR diff
            const { data: diff } = await this.octokit.rest.pulls.get({
                owner,
                repo,
                pull_number: pullRequestId,
                mediaType: { format: "diff" },
            });

            this.constructor.extractedDiffs = this.extractBlocks(diff);

            /**
             * Adding position to each line in the diff.
             */
            this.constructor.extractedDiffs = this.constructor.extractedDiffs.map(file => {
                const path = Object.keys(file)[0];
                const lines = file[path].split("\n");
                let position = 0;
                return {
                    [path]: lines.map(line => {
                        if (line.startsWith("@@")) {
                            position = -1;
                        }
                        position++;
                        return `${position} ${line}`;
                    }).join("\n")
                };
            });

            const diffText = this.constructor.extractedDiffs.map(obj => Object.values(obj)[0]).join('\n\n');

            const prTitle = prDetails.title || "";
            const prDescription = prDetails.body || "";

            let jiraTaskDetails = {};

            const url = "https://api.openai.com/v1/chat/completions";

            // Extract the JIRA Task ID from the PR title
            if(prTitle) {

                // OpenAI API request to extract the JIRA Task ID
                const response = await axios.post(url, {
                    model: this.model,
                    messages: [
                        { role: "system", content: "Extract the task ID from the given PR title. Ex. SD-123, SRT-1234 etc. Generally PR title format is: <task-id>: pr tile ex. SRT-12: Task name" },
                        { role: "user", content: prTitle},
                    ],
                    response_format: {
                        "type": "json_schema",
                        "json_schema":
                            {
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
                    max_tokens: 200,
                },{
                    headers: {
                        Authorization: `Bearer ${this.openaiApiKey}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 300000, // 300 seconds
                });

                const completion = response.data;

                const task_id = JSON.parse(completion.choices[0].message.content).task_id;

                if(task_id) {
                    core.info("Found Task ID: " + task_id);
                    jiraTaskDetails = await this.getJiraTaskDetails(task_id);
                }

            }

            // Prepare OpenAI API request

            const systemPrompt = `
            You are an experienced software reviewer. You will be given an incomplete code fragment where:
                - Lines starting with '+' represent newly added code (focus only on these).
                - Lines starting with '-' represent removed code.
            Task: Refactor, optimize, and validate the newly added lines. If no improvements are needed, respond with "LGTM!" and use the APPROVE event.    
            Instructions:
            - Cross-check the complete code against the relevant JIRA task and provide suggestions if necessary.
            - Provide specific code improvements focused on performance, readability, or best practices, using backticks for any code suggestions.
            - Strictly DO NOT provide explanations, compliments, or general feedback.
            `;

            let userPrompt = `
            Review the following code diff and take the PR title, description & Jira Task, description if any into account when writing the review.
             **PR Title:** 
             
             ${prTitle} 
             
             **PR Description:** 
            
             ${prDescription} 
             
             **Code Snippet:** 
             
             \`\`\`diff
             ${diffText}
              \`\`\`
             
             `;

            // Append to user context if jiraTaskDetails preset.
            if(jiraTaskDetails.taskSummary) {

                core.info('Using JIRA Task Details in the user prompt...');

                userPrompt += `
                **JIRA Task Summary:** 
                
                ${jiraTaskDetails.taskSummary}
                
                **JIRA Task Description:**
                
                ${jiraTaskDetails.taskDescription}
                `;
            }


            // Prepare the array of paths from the extractedDiffs
            const filePaths = this.constructor.extractedDiffs.map(file => Object.keys(file)[0]);

            const response = await axios.post(url, {
                model: this.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                'response_format': {
                    "type": "json_schema",
                    "json_schema":
                        {
                            "name": "pull_request_reviews",
                            "strict": true,
                            "schema":
                                {
                                    "type": "object",
                                    "properties":
                                        {
                                            "event":
                                                {
                                                    "type": "string",
                                                    "description": "The event type indicating the nature of the change request. APPROVE to approve the pull request, REQUEST_CHANGES to request MUST changes, or COMMENT to comment on the pull request.",
                                                    "enum": ["APPROVE", "REQUEST_CHANGES", "COMMENT"]
                                                },
                                            "comments":
                                                {
                                                    "type": "array",
                                                    "description": "A list of reviews provided for the pull request. Write LGTM! if no changes are requested.",
                                                    "items":
                                                        {
                                                            "type": "object",
                                                            "properties":
                                                                {
                                                                    "path":
                                                                        {
                                                                            "type": "string",
                                                                            "description": "The relative path to the file that necessitates a comment.",
                                                                            "enum": filePaths
                                                                        },
                                                                    "position":
                                                                        {
                                                                            "type": "number",
                                                                            "description": "Position in the file where you adding a comment. Start of the line indicates the position."
                                                                        },
                                                                    "body":
                                                                        {
                                                                            "type": "string",
                                                                            "description": "Single liner review comment. LGTM if no changes are requested."
                                                                        }
                                                                },
                                                            "required": ["path", "position", "body"],
                                                            "additionalProperties": false
                                                        }
                                                }
                                        },
                                    "required": ["event", "comments"],
                                    "additionalProperties": false
                                }
                        }
                },
                temperature: 1,
                top_p: 1,
                max_tokens: 16380,
            }, {
                headers: {
                    Authorization: `Bearer ${this.openaiApiKey}`,
                    "Content-Type": "application/json",
                },
                timeout: 300000, // 300 seconds
            });

            const completion = response.data;
            const review = JSON.parse(completion.choices[0].message.content);

            core.info("-------------------");
            core.info("AI Review: " + JSON.stringify(review));
            core.info("-------------------");

            const prComments = await this.getPullRequestComments(owner, repo, pullRequestId);

            await this.dismissPullRequestReview(pullRequestId, prComments);

            const positions = prComments.map(comment => comment.position);

            // Prepare comments for the review by removing the comments that are already present in the PR and comments that contain LGTM.
            const reviewComments = review.comments.filter(comment => !positions.includes(comment.position) && !comment.body.includes('LGTM') ).map(comment => ({
                path: comment.path,
                position: comment.position,
                body: comment.body,
            }));

            core.info('Final Review Comments: ' + JSON.stringify(reviewComments));

            await this.octokit.rest.pulls.createReview({
                owner,
                repo,
                pull_number: pullRequestId,
                comments: reviewComments || [],
                event: review.event || "COMMENT", // Default to COMMENT if no event specified
            });

            core.info("-------------------");
            core.info(`${reviewComments.length} Reviews added successfully!`);
            core.info("-------------------");

        } catch (error) {
            core.error(error.message);
        }
    }

    async dismissPullRequestReview(pullRequestId, prComments) {
        const owner = context.repo.owner;
        const repo = context.repo.repo;

        const url = "https://api.openai.com/v1/chat/completions";

        for(const comment of prComments) {
            if( comment.user.login === "github-actions[bot]" && comment.user.id === 41898282 ) {

                core.info("Dismissing review comment on Path: " + comment.path);

                // check if path exists in extractedDiffs
                const path = comment.path;
                core.info('Path: ' + path);
                const extractedDiffs = this.constructor.extractedDiffs;
                const file = extractedDiffs.find(file => file[path]);


                // Get the comment
                const commentText = comment.body;

                const userPrompt = `
                Code snippet:
                
                ${file[path]}
                
                Review Comment: 
                
                ${commentText}
                `;

                if(file) {

                    // Get the JIRA Task title and description


                    const response = await axios.post(url, {
                        model: this.model,
                        messages: [
                            { role: "system", content: 'You are an experienced software reviewer. Please verify the code snippet and determine whether the provided review has been addressed.' },
                            { role: "user", content: userPrompt },
                        ],
                        'response_format': {
                            "type": "json_schema",
                            "json_schema":
                                {
                                    "name": "pull_request_review_verify",
                                    "strict": true,
                                    "schema":
                                        {
                                            "type": "object",
                                            "properties":
                                                {
                                                    "status":
                                                        {
                                                            "type": "string",
                                                            "description": "RESOLVED if the review comment has been addressed, UNRESOLVED if the review comment has not been addressed.",
                                                            "enum": ["RESOLVED", "UNRESOLVED"]
                                                        }
                                                },
                                            "required": ["status"],
                                            "additionalProperties": false
                                        }
                                }
                        },
                        temperature: 1,
                        top_p: 1,
                        max_tokens: 2000,
                    }, {
                        headers: {
                            Authorization: `Bearer ${this.openaiApiKey}`,
                            "Content-Type": "application/json",
                        },
                        timeout: 300000, // 300 seconds
                    });

                    const completion = response.data;
                    const review = JSON.parse(completion.choices[0].message.content);

                    if(review.status === "RESOLVED") {

                        // Dismiss review
                        await this.octokit.rest.pulls.deleteReviewComment({
                            owner,
                            repo,
                            comment_id: comment.id
                        });

                        core.info("Review dismissed successfully!");
                    }

                }
            }
        }
    }

    async getJiraTaskDetails(task_id) {

        const username = core.getInput('JIRA_USERNAME');
        const token = core.getInput('JIRA_TOKEN');
        const jiraBaseUrl = core.getInput('JIRA_BASE_URL');
        const url = `${jiraBaseUrl}/rest/api/2/issue/${task_id}`;

        core.info('JIRA URL: ' + url);

        const response = await axios.get(url, {
            headers: {
                'Authorization': `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`
            }
        });

        const taskDetails = response.data;
        const taskSummary = taskDetails.fields.summary;
        const taskDescription = taskDetails.fields.description;

        return {
            taskSummary,
            taskDescription
        }

    }

    async getPullRequestComments(owner, repo, pullRequestId) {
        const { data } = await this.octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: pullRequestId,
        });
        return data;
    }

    extractBlocks(diff) {
        const fileExtensions = ["php", "js", "jsx"];
        const excludedFolders = ["vendor", "build", "dist", "node_modules"];
        const blocks = [];
        const lines = diff.split("\n");
        let currentBlock = [];
        let inBlock = false;
        let currentFile = "";

        lines.forEach(line => {
            // Start of a new block.
            if (line.startsWith("diff --git")) {
                if (inBlock && currentBlock.length > 0) {
                    if (this.matchesExtension(currentFile, fileExtensions)) {
                        blocks.push({ [currentFile]: currentBlock.join("\n") });
                    }
                    currentBlock = [];
                }

                const matches = line.match(/diff --git a\/(.*) b\//);
                currentFile = matches && matches[1] ? matches[1] : "";

                // Exclude files if the path contains any of the excluded folders
                if (excludedFolders.some(folder => currentFile.includes(folder))) {
                    inBlock = false; // Skip the current block
                } else {
                    inBlock = true;
                }
            }

            // If we're in a block, keep adding lines to it.
            if (inBlock) {
                currentBlock.push(line);
            }
        });

        // Add the last block if necessary.
        if (inBlock && this.matchesExtension(currentFile, fileExtensions)) {
            blocks.push({ [currentFile]: currentBlock.join("\n") });
        }

        return blocks;
    }


    matchesExtension(file, fileExtensions) {
        return fileExtensions.some(extension => file.endsWith(extension));
    }

    async run(pullRequestId) {



        core.info("Reviewing the pull request...");

        const result = await this.reviewPullRequest(pullRequestId);
        console.log(result);
    }
}

// Usage
const githubToken = core.getInput('GITHUB_TOKEN');
const openaiApiKey = core.getInput('OPENAI_API_KEY');
const model = core.getInput('OPENAI_API_MODEL') || 'gpt-4o-mini';

const reviewer = new PullRequestReviewer(githubToken, openaiApiKey, model);

try {
    reviewer.run(context.payload.pull_request.number) // Get the pull request ID from the context
        .catch(error => console.error(error));
} catch (error) {
    core.error(error.message);
}

