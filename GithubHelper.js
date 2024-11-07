const github = require("@actions/github");
const core = require("@actions/core");

class GitHubHelper {
    constructor(owner, repo, pull_number, token) {
        this.octokit = github.getOctokit(token);
        this.owner = owner;
        this.repo = repo;
        this.pull_number = pull_number;
    }

    async getPullRequest(prNumber) {
        try {

            const { data: prData } = await this.octokit.rest.pulls.get({
                owner: this.owner,
                repo: this.repo,
                pull_number: prNumber,
            });

            return prData;
        } catch (error) {
            core.error(error.message);
            throw error;
        }
    }

    async getPullRequestDiff(prNumber) {
        try {
            const { data: prData } = await this.octokit.rest.pulls.get({
                owner: this.owner,
                repo: this.repo,
                pull_number: prNumber,
                mediaType: {
                    format: "diff",
                },
            });
            return prData;
        } catch (error) {
            core.error(error.message);
            throw error;
        }
    }

    async updatePullRequestBody(body) {
        try {
            await this.octokit.rest.pulls.update({
                owner: this.owner,
                repo: this.repo,
                pull_number: this.pull_number,
                body,
            });
        } catch (error) {
            core.error(error.message);
            throw error;
        }
    }

    async listFiles(prNumber) {
        try {
            const { data: changedFiles } = await this.octokit.rest.pulls.listFiles({
                owner: this.owner,
                repo: this.repo,
                pull_number: prNumber,
            });
            return changedFiles;
        } catch (error) {
            core.error(error.message);
            throw error;
        }
    }

    async createReview(pull_number, event, body) {
        try {
            await this.octokit.rest.pulls.createReview({
                owner: this.owner,
                repo: this.repo,
                pull_number,
                event,
                body,
            });
        } catch (error) {
            core.error(`Error creating review: ${error.message}`);
            throw error;
        }
    }

    async listReviews(pull_number) {

        try {
            const { data: prReviews } = await this.octokit.rest.pulls.listReviews({
                owner: this.owner,
                repo: this.repo,
                pull_number,
            });
            return prReviews;
        } catch (error) {
            core.error(error.message);
            throw error;
        }
    }

    async createReviewComment(commit_id, side, line, path, body) {
        try {
            await this.octokit.rest.pulls.createReviewComment({
                owner: this.owner,
                repo: this.repo,
                pull_number: this.pull_number,
                body,
                commit_id,
                path,
                line,
                side,
            });
        } catch (error) {
            core.error(error.message);
            throw error;
        }
    }

    async deleteComment(comment_id) {
        try {
            await this.octokit.rest.pulls.deleteReviewComment({
                owner: this.owner,
                repo: this.repo,
                comment_id,
            });
        } catch (error) {
            core.error(error.message);
            throw error;
        }
    }

    async getPullRequestComments(pullRequestId) {
        try {
            const { data } = await this.octokit.rest.pulls.listReviewComments({
                owner: this.owner,
                repo: this.repo,
                pull_number: pullRequestId,
            });
            return data;
        } catch (error) {
            core.error(error.message);
            throw error;
        }
    }
}

module.exports = GitHubHelper;
