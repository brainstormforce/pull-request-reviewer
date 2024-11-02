const {Octokit} = require("@octokit/rest");
const axios = require("axios");
const {GitHub, context} = require("@actions/github");
const core = require("@actions/core");

const AiHelper = require("./AiHelper");
const GithubHelper = require("./GithubHelper");

class PullRequestReviewer {

    /**
     * Initialize the PullRequestReviewer.
     * @param owner
     * @param repo
     * @param pull_number
     * @param githubHelper
     */
    constructor(owner, repo, pull_number, githubHelper, aiHelper) {
        this.owner = owner;
        this.repo = repo;
        this.pull_number = pull_number;
        this.githubHelper = githubHelper;
        this.aiHelper = aiHelper;
    }


    async reviewPullRequest(pullRequestData) {

        const stringToArray = (inputString, delimiter = ',') =>
            inputString.split(delimiter).map(item => item.trim());


        const includeExtensions = stringToArray(core.getInput('INCLUDE_EXTENSIONS'));
        const excludeExtensions = stringToArray(core.getInput('EXCLUDE_EXTENSIONS'));
        const includePaths = stringToArray(core.getInput('INCLUDE_PATHS'));
        const excludePaths = stringToArray(core.getInput('EXCLUDE_PATHS'));

        const getReviewableFiles = (changedFiles, includeExtensionsArray, excludeExtensionsArray, includePathsArray, excludePathsArray) => {
            const isFileToReview = (filename) => {
                const isIncludedExtension = includeExtensionsArray.length === 0 || includeExtensionsArray.some(ext => filename.endsWith(ext));
                const isExcludedExtension = excludeExtensionsArray.length > 0 && excludeExtensionsArray.some(ext => filename.endsWith(ext));
                const isIncludedPath = includePathsArray.length === 0 || includePathsArray.some(path => filename.startsWith(path));
                const isExcludedPath = excludePathsArray.length > 0 && excludePathsArray.some(path => filename.startsWith(path));

                return isIncludedExtension && !isExcludedExtension && isIncludedPath && !isExcludedPath;
            };

            return changedFiles.filter(file => isFileToReview(file.filename.replace(/\\/g, '/')));
        };


        const checkApprovalStatus = async () => {

            core.info('Checking PR Approval Status...');

            /**
             * Get the PR comments again after the review to check if the reviewer has approved the PR.
             */
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

        }

        try {


            if (pullRequestData.review_comments > 0) {
                core.info("Pull Request has review comments. Skipping the review.");
                await checkApprovalStatus();
                process.exit(0);
            }


            // List all PR files
            const changedFiles = await this.githubHelper.listFiles(this.pull_number);

            /**
             * Filter files based on the extensions and paths provided.
             */
            const reviewableFiles = getReviewableFiles(changedFiles, includeExtensions, excludeExtensions, includePaths, excludePaths);


            /**
             * Initialize AI Helper
             */


            let prComments = await this.githubHelper.getPullRequestComments(this.pull_number);

            await this.aiHelper.executeCodeReview(reviewableFiles, prComments, githubHelper);

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
        const taskSummary = taskDetails.fields.summary;
        const taskDescription = taskDetails.fields.description;

        return {
            taskSummary,
            taskDescription
        }

    }


    async checkShortCode() {

        const prData = await this.githubHelper.getPullRequest(this.pull_number);
        const prDiff = await this.githubHelper.getPullRequestDiff(this.pull_number);

        const prDescription = prData.body;
        const prTitle = prData.title;

        // check if body contains [BSF-PR-SUMMARY] shortcode
        const shortCodeRegex = /(\[BSF-PR-SUMMARY\])/g;

        const shortCodes = prDescription.match(shortCodeRegex);

        if (shortCodes) {

            const summary = await this.aiHelper.getPrSummary(prTitle, prDiff);
            const newPrDescription = prDescription.replace(shortCodeRegex, summary);
            await this.githubHelper.updatePullRequestBody(newPrDescription);

            core.info("PR Summary added to the PR Description.");

        } else {
            core.info('No Short Codes found in the PR description.');
        }
    }
}


try {

    const openaiApiKey = core.getInput('OPENAI_API_KEY');
    const actionContext = core.getInput('ACTION_CONTEXT');
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const pull_number = context.payload.pull_request.number;
    const githubToken = core.getInput('GITHUB_TOKEN');

    const githubHelper = new GithubHelper(owner, repo, pull_number, githubToken);

    /**
     * Get the pull request data
     */
    const pullRequestData = await this.githubHelper.getPullRequest(this.pull_number);


    /**
     * Prepare PR details to be used in AI Helper.
     */
    const prDetails = {
        prTitle: pullRequestData.title,
        prDescription: pullRequestData.body,
    };

    const aiHelper = new AiHelper(openaiApiKey, prDetails);


    const reviewer = new PullRequestReviewer(owner, repo, pull_number, githubHelper, aiHelper);


    switch (actionContext) {
        case 'CHECK_SHORTCODE':
            await reviewer.checkShortCode().catch(error => console.error(error));
            break;
        default:
            await reviewer.reviewPullRequest(pullRequestData).catch(error => console.error(error));
    }


} catch (error) {
    core.error(error.message);
}

