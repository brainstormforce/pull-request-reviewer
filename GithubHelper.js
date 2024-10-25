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
            core.error(error.message)
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
            core.error(error.message)
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
            core.error(error.message)
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
            core.error(error.message)
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
            core.error(error.message)
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
            core.error(`Error creating review: ${error.message}`);
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
            core.error(error.message)
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




