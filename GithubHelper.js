const github = require("@actions/github");
const core = require("@actions/core");
const {context} = require("@actions/github");
const axios = require("axios");

class GitHubHelper {

    constructor(owner, repo, pull_number, token) {
        this.octokit = github.getOctokit(token);
        this.owner = owner;
        this.repo = repo;
        this.pull_number = pull_number;

    }

    async getPullRequest(prNumber) {
        try {
            const {data: prData} = await this.octokit.rest.pulls.get({
                owner: this.owner,
                repo: this.repo,
                pull_number: prNumber,
            });
            return prData;
        } catch (error) {
            core.error(error.message);
        }
    }

    async listFiles(prNumber) {
        try {
            const {data: changedFiles} = await this.octokit.rest.pulls.listFiles({
                owner: this.owner,
                repo: this.repo,
                pull_number: prNumber,
            });
            return changedFiles;
        } catch (error) {
            core.error(error.message);
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
                side
            });
        } catch (error) {
            core.error(error.message);
        }
    }

    async deleteComment(comment_id) {
        try {
            await this.octokit.rest.pulls.deleteReviewComment({
                owner: this.owner,
                repo: this.repo,
                comment_id
            });
        } catch (error) {
            core.error(error.message);
        }

    }

    async getPullRequestComments(pullRequestId) {
        const {data} = await this.octokit.rest.pulls.listReviewComments({
            owner: this.owner,
            repo: this.repo,
            pull_number: pullRequestId,
        });
        return data;
    }

}

module.exports = GitHubHelper;




