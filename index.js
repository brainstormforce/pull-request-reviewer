import axios from "axios";
import { GitHub, context } from "@actions/github";
import * as core from "@actions/core";

import AiHelper from "./AiHelper.js";
import GithubHelper from "./GithubHelper.js";

class PullRequestReviewer {
    constructor(owner, repo, pull_number, githubHelper, aiHelper) {
        this.owner = owner;
        this.repo = repo;
        this.pull_number = pull_number;
        this.githubHelper = githubHelper;
        this.aiHelper = aiHelper;
    }


    async getReviewableFiles() {
        const stringToArray = (input, delimiter = ',') =>
            input ? input.split(delimiter).map(item => item.trim()) : [];

        const isMatch = (filename, includeExtensions, excludeExtensions, includePaths, excludePaths) => {
            const matchesExtension = (extensions) => extensions.some(ext => filename.endsWith(ext));
            const matchesPath = (paths) => paths.some(path => filename.startsWith(path));

            const isIncludedExtension = !includeExtensions.length || matchesExtension(includeExtensions);
            const isExcludedExtension = excludeExtensions.length && matchesExtension(excludeExtensions);
            const isIncludedPath = !includePaths.length || matchesPath(includePaths);
            const isExcludedPath = excludePaths.length && matchesPath(excludePaths);

            return isIncludedExtension && !isExcludedExtension && isIncludedPath && !isExcludedPath;
        };

        const getInputArray = (name) => stringToArray(core.getInput(name));

        const [includeExtensions, excludeExtensions, includePaths, excludePaths] =
            ['INCLUDE_EXTENSIONS', 'EXCLUDE_EXTENSIONS', 'INCLUDE_PATHS', 'EXCLUDE_PATHS'].map(getInputArray);

        const changedFiles = await this.githubHelper.listFiles(this.pull_number);
        return changedFiles.filter(file => isMatch(file.filename.replace(/\\/g, '/'), includeExtensions, excludeExtensions, includePaths, excludePaths));
    }


    async reviewPullRequest(pullRequestData) {

        const checkApprovalStatus = async () => {

            const prComments = await this.githubHelper.getPullRequestComments(this.pull_number);
            let existingPrComments = prComments.map(comment => {
                return comment.body.match(/What:(.*)(?=Why:)/s)?.[1]?.trim();
            }).filter(Boolean);

            let isApproved = await this.aiHelper.checkApprovalStatus(existingPrComments);
            core.info("PR Approval Status: " + isApproved);

            if (isApproved) {
                await this.githubHelper.createReview(this.pull_number, "APPROVE", "\n" +
                    "Great job! ✅ The PR looks solid with no security or performance issues.\n" +
                    "\n" +
                    "Please make sure to resolve any remaining comments if any. **Approved** :thumbsup:");
            }
        };

        try {
            if (pullRequestData.review_comments > 0) {
                core.info("Pull Request has review comments. Skipping the review.");
                await checkApprovalStatus();
                process.exit(0);
            }

            const reviewableFiles = await this.getReviewableFiles();
            let prComments = await this.githubHelper.getPullRequestComments(this.pull_number);
            await this.aiHelper.executeCodeReview(reviewableFiles, prComments, this.githubHelper);
            await checkApprovalStatus();

        } catch (error) {
            core.error(error.message);
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
        return {
            taskSummary: taskDetails.fields.summary,
            taskDescription: taskDetails.fields.description
        };
    }

    async checkShortCode() {

        const prData = await this.githubHelper.getPullRequest(this.pull_number);

        const reviewableFiles = await this.getReviewableFiles();

        core.info( JSON.stringify(reviewableFiles) );
        process.exit(0)

        const prDescription = prData.body;
        const prTitle = prData.title;

        const shortCodeRegex = /(\[BSF-PR-SUMMARY\])/g;
        const shortCodes = prDescription.match(shortCodeRegex);

        if (shortCodes) {
            const summary = await this.aiHelper.getPrSummary(prTitle, prDiff);
            const newPrDescription = prDescription.replace(shortCodeRegex, summary);
            await this.githubHelper.updatePullRequestBody(newPrDescription);

            core.info("PR Summary added to the PR Description 🎉");
        } else {
            core.info('No shortcode! Skipping the process. ❎');
        }
    }
}

async function main() {
    try {
        const openaiApiKey = core.getInput('OPENAI_API_KEY');
        const actionContext = core.getInput('ACTION_CONTEXT');
        const owner = context.repo.owner;
        const repo = context.repo.repo;
        const pull_number = context.payload.pull_request.number;
        const githubToken = core.getInput('GITHUB_TOKEN');

        const githubHelper = new GithubHelper(owner, repo, pull_number, githubToken);
        const pullRequestData = await githubHelper.getPullRequest(pull_number);

        const prDetails = {
            prTitle: pullRequestData.title,
            prDescription: pullRequestData.body,
        };

        const aiHelper = new AiHelper(openaiApiKey, prDetails);
        const reviewer = new PullRequestReviewer(owner, repo, pull_number, githubHelper, aiHelper);

        core.info('--------------------------------------');
        core.info('Action Context: ' + actionContext);
        core.info('--------------------------------------');

        switch (actionContext) {
            case 'CHECK_SHORTCODE':
                await reviewer.checkShortCode().catch(error => console.error(error));
                break;
            case 'CODE_REVIEW':
                await reviewer.reviewPullRequest(pullRequestData).catch(error => console.error(error));
                break;
            default:
                core.warning('Invalid action context. Exiting the process. ❎');

        }
    } catch (error) {
        core.error(error.message);
    }
}

// Run the main function
main();
