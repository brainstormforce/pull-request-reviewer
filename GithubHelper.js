const github = require("@actions/github");
const core = require("@actions/core");
const {context} = require("@actions/github");
const axios = require("axios");

class GitHubHelper {
    constructor(token) {
        this.octokit = github.getOctokit(token);
    }

    async compareCommits(owner, repo, baseBranchName, headBranchName) {
        try {
            const { data: diff } = await this.octokit.rest.repos.compareCommits({
                owner,
                repo,
                base: baseBranchName,
                head: headBranchName,
            });
            return diff;
        } catch (error) {
            throw new Error(`Error comparing commits: ${error.message}`);
        }
    }

    async getPullRequest(owner, repo, prNumber) {
        try {
            const { data: prData } = await this.octokit.rest.pulls.get({
                owner,
                repo,
                pull_number: prNumber,
            });
            return prData;
        } catch (error) {
            throw new Error(`Error retrieving pull request: ${error.message}`);
        }
    }

    async listFiles(owner, repo, prNumber) {
        try {
            const { data: changedFiles } = await this.octokit.rest.pulls.listFiles({
                owner,
                repo,
                pull_number: prNumber,
            });
            return changedFiles;
        } catch (error) {
            throw new Error(`Error listing changed files: ${error.message}`);
        }
    }

    async getContent(owner, repo, filePath, ref) {
        try {
            const { data: fileContent } = await this.octokit.rest.repos.getContent({
                owner,
                repo,
                path: filePath,
                ref,
            });

            let extractedCode =  Buffer.from(fileContent.content, "base64").toString("utf-8");

            return extractedCode;
        } catch (error) {
            throw new Error(`Error retrieving file content: ${error.message}`);
        }
    }

    async createPRComment(owner, repo, prNumber, body) {
        try {
            await this.octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: prNumber,
                body,
            });
        } catch (error) {
            throw new Error(`Error creating comment: ${error.message}`);
        }
    }

    async createReview(owner, repo, pull_number, event, body) {
        try {

              await this.octokit.rest.pulls.createReview({
                owner,
                repo,
                pull_number,
                event,
                body,
            });
        } catch (error) {
            throw new Error(`Error creating review: ${error.message}`);
        }
    }

    async createReviewComment(owner, repo, pull_number, commit_id, body, path, line, side) {
        try {

            core.info("---------------- Creating Review Comment ----------------");
            core.info(`Body: ${body}`);
            core.info(`Path: ${path}`);
            core.info(`Line: ${line}`);
            core.info("---------------------------------------------");

            await this.octokit.rest.pulls.createReviewComment({
                owner,
                repo,
                pull_number,
                body,
                commit_id,
                path,
                line,
                side
            });
        } catch (error) {
            throw new Error(`Error creating review comment: ${error.message}`);
        }
    }

    async dismissPullRequestReview(owner, repo, pullRequestId, prComments, reviewableFiles) {



        for(const comment of prComments) {
            if( comment.user.login === "github-actions[bot]" && comment.user.id === 41898282 ) {

                core.info("Dismissing review comment on Path: " + comment.path);

                // check if path exists in extractedDiffs
                const path = comment.path;

                const commentText = comment.body;

                // Get the Path patch from reviewableFiles
                let file = reviewableFiles.find(file => file.filename === path);

                const userPrompt = `
                Code snippet:
                
                ${file.patch}
                
                Review Comment: 
                
                ${commentText}
                `;

                if(file) {

                    // Get the JIRA Task title and description

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

    async getPullRequestComments(owner, repo, pullRequestId) {
        const { data } = await this.octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: pullRequestId,
        });
        return data;
    }

}

module.exports = GitHubHelper;




