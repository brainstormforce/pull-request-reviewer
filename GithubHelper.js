const github = require("@actions/github");
const core = require("@actions/core");
const {context} = require("@actions/github");
const axios = require("axios");

class GitHubHelper {
    
    constructor(owner, repo, token) {
        this.octokit = github.getOctokit(token);
        this.owner = owner;
        this.repo = repo;
        
    }

    async getPullRequest(prNumber) {
        try {
            const { data: prData } = await this.octokit.rest.pulls.get({
               owner: this.owner,
               repo: repo,
                pull_number: prNumber,
            });
            return prData;
        } catch (error) {
            core.error(error.message);
        }
    }

    async listFiles(prNumber) {
        try {
            const { data: changedFiles } = await this.octokit.rest.pulls.listFiles({
               owner: this.owner,
               repo: repo,
                pull_number: prNumber,
            });
            return changedFiles;
        } catch (error) {
            core.error(error.message);
        }
    }

    async getContent( filePath, ref) {
        try {
            const { data: fileContent } = await this.octokit.rest.repos.getContent({
               owner: this.owner,
               repo: repo,
                path: filePath,
                ref,
            });

            let extractedCode =  Buffer.from(fileContent.content, "base64").toString("utf-8");

            return extractedCode;
        } catch (error) {
            core.error(error.message);
        }
    }

    async createPRComment(prNumber, body) {
        try {
            await this.octokit.rest.issues.createComment({
               owner: this.owner,
               repo: repo,
                issue_number: prNumber,
                body,
            });
        } catch (error) {
            core.error(error.message);
        }
    }

    async createReview( pull_number, event, body) {
        try {

              await this.octokit.rest.pulls.createReview({
               owner: this.owner,
               repo: repo,
                pull_number,
                event,
                body,
            });
        } catch (error) {
            core.error(`Error creating review: ${error.message}`);
        }
    }

    async createReviewComment( pull_number, commit_id, body, path, line, side) {
        try {

            core.info("---------------- Creating Review Comment ----------------");
            core.info(`Body: ${body}`);
            core.info(`Path: ${path}`);
            core.info(`Line: ${line}`);
            core.info("---------------------------------------------");

            await this.octokit.rest.pulls.createReviewComment({
               owner: this.owner,
               repo: repo,
                pull_number,
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

    async updateReviewComment( comment_id, body) {
        try {
            await this.octokit.rest.pulls.updateReviewComment({
               owner: this.owner,
               repo: repo,
                comment_id,
                body,
            });
            
        } catch (error) {
            core.error(error.message);
        }
    }


    async getPullRequestComments(pullRequestId) {
        const { data } = await this.octokit.rest.pulls.listReviewComments({
           owner: this.owner,
           repo: repo,
            pull_number: pullRequestId,
        });
        return data;
    }

}

module.exports = GitHubHelper;




