const {Octokit} = require("@octokit/rest");
const axios = require("axios");
const {GitHub, context} = require("@actions/github");
const core = require("@actions/core");

const AiHelper = require("./AiHelper");
const GithubHelper = require("./GithubHelper");

class PullRequestReviewer {

    constructor(githubToken, openaiApiKey, model) {
        this.octokit = new Octokit({auth: githubToken});
        this.openaiApiKey = openaiApiKey;
        this.model = model;
        this.baseUrl = "https://api.github.com";
    }

    async reviewPullRequest(pullRequestId) {

        const owner = context.repo.owner;
        const repo = context.repo.repo;
        const includeExtensions = core.getInput('INCLUDE_EXTENSIONS') || ["php", "js", "jsx"];
        const excludeExtensions = core.getInput('EXCLUDE_EXTENSIONS') || [];
        const includePaths = core.getInput('INCLUDE_PATHS') || [];
        const excludePaths = core.getInput('EXCLUDE_PATHS') || [];
        const githubToken = core.getInput('GITHUB_TOKEN');

        const githubHelper = new GithubHelper(githubToken);

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

        try {

            // List all PR files
            const {data: changedFiles} = await this.octokit.rest.pulls.listFiles({
                owner,
                repo,
                pull_number: pullRequestId,
            });

            /**
             * Filter files based on the extensions and paths provided.
             */
            const reviewableFiles = getReviewableFiles(changedFiles, includeExtensions, excludeExtensions, includePaths, excludePaths);

            /**
             * Get the pull request data
             */
            const pullRequestData = await githubHelper.getPullRequest(owner, repo, pullRequestId);

            /**
             * Prepare PR details to be used in AI Helper.
             */
            const prDetails = {
                prTitle: pullRequestData.title,
                prDescription: pullRequestData.body,
            };

            const fileContentGetter = async (filePath) => await githubHelper.getContent(owner, repo, filePath, pullRequestData.head.sha);
            const fileCommentator = (comment, filePath, line, side) => {
                githubHelper.createReviewComment(owner, repo, pullRequestId, pullRequestData.head.sha, comment, filePath, line, side);
            }

            /**
             * Initialize AI Helper
             */
            const aiHelper = new AiHelper(openaiApiKey, fileContentGetter, fileCommentator, prDetails);


            const prComments = await githubHelper.getPullRequestComments(owner, repo, pullRequestId);

            core.info('PR Comments: ' + JSON.stringify(prComments, null, 2));

            process.exit(0);



            await aiHelper.executeCodeReview(reviewableFiles);

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


    async run(pullRequestId) {

        core.info('---------------------Started Reviewing Pull Request---------------------');

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

