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

        // Get the latest commit SHA for the pull request
        const latestCommitSha = prResponse.data.head.sha;

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
                    // Add comments for each AI response
                    for (const res of response) {
                        const position = findPositionInChunk(chunk, res.lineNumber);

                        core.info(`Found position ${position} for line ${res.lineNumber}`);

                        if (position === -1) {
                            core.info(`Skipping review for line ${res.lineNumber} as no matching position was found.`);
                            continue;
                        }

                        // Check if a comment already exists on this position
                        const existingComments = await getExistingReviewComments(octokit, repo.owner, repo.repo, prNumber);
                        if (existingComments.some(comment => comment.path === file.to && comment.position === position)) {
                            core.info(`Skipping duplicate comment on line ${res.lineNumber} at position ${position}.`);
                            continue;
                        }

                        core.info(`Adding review comment for line ${res.lineNumber} at position ${position}`);

                        await addReviewComment(octokit, repo.owner, repo.repo, prNumber, latestCommitSha, file.to, position, res.reviewComment);

                        core.info(`Added review comment for file: ${file.to} at position: ${position}`);
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

// Function to find the correct diff position from the chunk and line number
function findPositionInChunk(chunk, lineNumber) {
    for (const change of chunk.changes) {
        // Find the correct diff position by matching the line number from the diff
        if ((change.ln || change.ln2) === lineNumber) {
            return change.position; // The position in the diff
        }
    }
    return -1; // Return -1 if no matching position is found
}

// Function to add a review comment to the pull request
async function addReviewComment(octokit, owner, repo, pull_number, commit_id, path, position, body) {
    try {
        const response = await octokit.rest.pulls.createReviewComment({
            owner,
            repo,
            pull_number,
            commit_id, // The latest commit SHA for the PR
            path,      // File path within the PR
            position,  // The position in the diff (not the line number!)
            body,      // The comment body
        });

        core.info(`Review comment added successfully at position ${position}`);
        return response;
    } catch (error) {
        core.error(`Error while adding review comment: ${error.message}`);
        throw error;
    }
}

// Function to retrieve existing review comments for the pull request
async function getExistingReviewComments(octokit, owner, repo, pull_number) {
    try {
        const { data: comments } = await octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number,
        });
        return comments;
    } catch (error) {
        core.error(`Error while fetching existing comments: ${error.message}`);
        return [];
    }
}

run();
