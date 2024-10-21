const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const minimatch = require('minimatch');
const parseDiff = require('parse-diff');
const fs = require('fs');

async function run() {
    try {
        // Get input values from action.yml
        const githubToken = core.getInput('GITHUB_TOKEN');
        const openaiApiKey = core.getInput('OPENAI_API_KEY');
        const model = core.getInput('OPENAI_API_MODEL') || 'gpt-4';
        const excludePatterns = core.getInput('exclude').split(',').map(p => p.trim());

        const octokit = github.getOctokit(githubToken);
        const { context } = github;

        // Load the event data to retrieve pull request details
        const eventData = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH || '', 'utf8'));
        const repo = context.repo;

        // Get PR number and details
        const prNumber = eventData.pull_request ? eventData.pull_request.number : null;
        if (!prNumber) {
            core.setFailed('Pull request number not found.');
            return;
        }

        core.info(`Reviewing PR #${prNumber} in repo ${repo.owner}/${repo.repo}`);

        // Get PR details (title and description)
        const prResponse = await octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: prNumber
        });
        const prDetails = {
            title: prResponse.data.title || '',
            description: prResponse.data.body || '',
        };

        // Get the diff for the pull request
        const { data: diffData } = await octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: prNumber,
            mediaType: { format: 'diff' },
        });

        // Parse the diff data
        const parsedDiff = parseDiff(diffData);

        // Filter out excluded files based on the patterns
        const filesToReview = parsedDiff.filter(file => {
            return !excludePatterns.some(pattern => minimatch(file.to, pattern));
        });

        if (filesToReview.length === 0) {
            core.info("No files to review after applying exclude patterns.");
            return;
        }

        core.info(`Files to review: ${filesToReview.map(f => f.to).join(', ')}`);

        // Get existing comments for the pull request
        const { data: existingComments } = await octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: prNumber
        });

        // Iterate through each file and chunk in the diff
        for (const file of filesToReview) {
            if (file.to === '/dev/null') continue; // Ignore deleted files

            core.info(`Reviewing file: ${file.to}`);

            for (const chunk of file.chunks) {
                // Create prompt for the specific chunk
                const prompt = createPrompt(file, chunk, prDetails);

                core.info(`Prompt for chunk: ${prompt}`);

                // Send the chunk content to OpenAI for review
                const response = await getAIResponse(openaiApiKey, model, prompt);

                if (response && response.length > 0) {
                    // Filter out comments that already exist on the line
                    const comments = response.filter(res => !commentExists(existingComments, file.to, res.lineNumber))
                        .map(res => ({
                            body: res.reviewComment,
                            path: file.to,
                            line: res.lineNumber
                        }));

                    if (comments.length > 0) {
                        await addReviewComments(octokit, repo.owner, repo.repo, prNumber, comments);
                        core.info(`Added review comments for file: ${file.to}`);
                    } else {
                        core.info(`No new comments to add for file: ${file.to}`);
                    }
                }
            }
        }

    } catch (error) {
        core.setFailed(error.message);
    }
}

// Function to create a prompt for OpenAI
function createPrompt(file, chunk, prDetails) {
    return `
        Your task is to review pull requests. Instructions:
        - Provide the response in raw JSON format without any markdown or code blocks.
        - Response format: {"reviews": [{"lineNumber": <line_number>, "reviewComment": "<review comment>"}]}
        - Only suggest improvements; no compliments or comments if there is nothing to change.
        - Write comments in GitHub Markdown format.

        Review the following code diff in the file "${file.to}" considering the PR title and description:

        Pull request title: ${prDetails.title}
        Pull request description: ${prDetails.description}

        Git diff to review:

        ${chunk.content}
        ${chunk.changes.map(c => `${c.ln || c.ln2} ${c.content}`).join('\n')}
    `;
}

// Function to call OpenAI for review
async function getAIResponse(apiKey, model, prompt) {
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500,
            temperature: 0.2,
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
        });

        const res = response.data.choices[0].message.content.trim();
        return JSON.parse(res).reviews || [];
    } catch (error) {
        core.error(`Error while calling OpenAI: ${error.message}`);
        return null;
    }
}

// Function to check if a comment already exists on the same line
function commentExists(existingComments, filePath, lineNumber) {
    return existingComments.some(comment => comment.path === filePath && comment.line === lineNumber);
}

// Function to add review comments to the pull request
async function addReviewComments(octokit, owner, repo, pull_number, comments) {
    for (const comment of comments) {
        await octokit.rest.pulls.createReviewComment({
            owner,
            repo,
            pull_number,
            body: comment.body,
            path: comment.path,
            line: comment.line,
        });
    }
}

run();
