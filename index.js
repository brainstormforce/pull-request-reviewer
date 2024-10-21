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

        // Prepare the entire code for AI review
        let fullDiffContent = '';

        for (const file of filesToReview) {
            if (file.to === '/dev/null') continue; // Ignore deleted files

            core.info(`Reviewing file: ${file.to}`);
            fullDiffContent += `\nFile: ${file.to}\n`;

            // Check if chunks exist and are an array before mapping
            if (Array.isArray(file.chunks)) {
                fullDiffContent += file.chunks.map(chunk => chunk.content).join('\n');
            }

            // Check if changes exist and are an array before mapping
            if (Array.isArray(file.changes)) {
                fullDiffContent += '\n' + file.changes.map(c => `${c.ln || c.ln2} ${c.content}`).join('\n');
            }
        }

        // Create prompt for AI
        const prompt = createPrompt(fullDiffContent, prDetails);
        core.info(`Prompt for AI: ${prompt}`);

        // Send the entire code diff to OpenAI for review
        const response = await getAIResponse(openaiApiKey, model, prompt);

        if (response && response.length > 0) {
            const { reviews, changesRequested } = response;

            if (changesRequested) {
                // If there are requested changes, add them to the PR
                await addReviewComments(octokit, repo.owner, repo.repo, prNumber, reviews);
                core.info(`Added review comments for PR #${prNumber}`);
            } else {
                // Mark the PR as approved if no changes are requested
                await approvePullRequest(octokit, repo.owner, repo.repo, prNumber);
                core.info(`PR #${prNumber} marked as approved.`);
            }
        } else {
            core.info('No response received from AI.');
        }

    } catch (error) {
        core.setFailed(error.message);
    }
}

// Function to create a prompt for OpenAI
function createPrompt(diffContent, prDetails) {
    return `
        Your task is to review the following pull request. Provide the response in raw JSON format without any markdown or code blocks.
        Response format: {"reviews": [{"lineNumber": <line_number>, "reviewComment": "<review comment>"}], "changesRequested": <boolean>}
        If no changes are needed, set changesRequested to false.

        Review the following code diff considering the PR title and description:

        Pull request title: ${prDetails.title}
        Pull request description: ${prDetails.description}

        Git diff to review:

        ${diffContent}
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
        return JSON.parse(res);
    } catch (error) {
        core.error(`Error while calling OpenAI: ${error.message}`);
        return null;
    }
}

// Function to add review comments to the pull request
async function addReviewComments(octokit, owner, repo, pull_number, comments) {
    for (const comment of comments) {
        await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: pull_number,
            body: `### Review for line ${comment.line} in \`${comment.path}\`\n\n${comment.body}`,
        });
    }
}

// Function to approve the pull request
async function approvePullRequest(octokit, owner, repo, pull_number) {
    await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number,
        event: 'APPROVE',
        body: 'Automated approval: No changes requested.',
    });
}

run();
