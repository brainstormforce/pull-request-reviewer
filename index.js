const { Octokit } = require("@octokit/rest");
const axios = require("axios");
const { GitHub, context } = require("@actions/github");
const core = require("@actions/core");

class PullRequestReviewer {
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

            const extractedDiffs = this.extractBlocks(diff);
            const diffText = extractedDiffs.join("\n\n");

            const prTitle = prDetails.title || "";
            const prDescription = prDetails.body || "";

            // Prepare OpenAI API request
            const url = "https://api.openai.com/v1/chat/completions";
            const systemPrompt = `You are an experienced software reviewer. You will be given a code snippet which represents incomplete code fragments annotated with line numbers and old hunks (replaced code). Focus solely on the '+' (added) lines in the provided code snippet and ignore the rest of the code. Refactor and optimize the code snippet and provide feedback only for potential improvements on newly added code if necessary. Else directly write "LGTM!" as a review. Instructions: - Do not provide compliments, general feedback, summaries, explanations, or praise for changes. - Use backticks if any code improvement is suggested. ex. \`<Code>\``;

            const userPrompt = `Review the following code diff and take the PR title and description into account when writing the review. **PR Title:** ${prTitle} **PR Description:** ${prDescription} **Code Snippet:** ${diffText}`;

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
                                                                            "description": "The file path where the change is requested."
                                                                        },
                                                                    "position":
                                                                        {
                                                                            "type": "number",
                                                                            "description": "To determine the position, count the lines below the first '@@' hunk header in the file. The line immediately after the '@@' line is position 1, the next line is position 2, and so on. This position increases through whitespace and additional hunks until a new file begins."
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
            const positions = prComments.map(comment => comment.position);

            // Prepare comments for the review
            const reviewComments = review.comments.filter(comment => !positions.includes(comment.position)).map(comment => ({
                path: comment.path,
                position: comment.position,
                body: comment.body,
            }));

            if (reviewComments.length > 0) {
                // Create the review
                await this.octokit.rest.pulls.createReview({
                    owner,
                    repo,
                    pull_number: pullRequestId,
                    comments: reviewComments,
                    event: review.event || "COMMENT", // Default to COMMENT if no event specified
                });
            }

            core.info("-------------------");
            core.info(`${reviewComments.length} Reviews added successfully!`);
            core.info("-------------------");

        } catch (error) {
            return {
                error: error.message,
            };
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
                        blocks.push(currentBlock.join("\n"));
                    }
                    currentBlock = [];
                }

                const matches = line.match(/diff --git a\/(.*) b\//);
                currentFile = matches && matches[1] ? matches[1] : "";
                inBlock = true;
            }

            // If we're in a block, keep adding lines to it.
            if (inBlock) {
                currentBlock.push(line);
            }
        });

        // Add the last block if necessary.
        if (inBlock && this.matchesExtension(currentFile, fileExtensions)) {
            blocks.push(currentBlock.join("\n"));
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
reviewer.run(context.payload.pull_request.number) // Get the pull request ID from the context
    .catch(error => console.error(error));
