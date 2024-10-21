const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const minimatch = require('minimatch');
const parseDiff = require('parse-diff');
const fs = require('fs');

async function run() {
    try {
        const githubToken = core.getInput('GITHUB_TOKEN');
        const openaiApiKey = core.getInput('OPENAI_API_KEY');
        const model = core.getInput('OPENAI_API_MODEL') || 'gpt-4';
        const excludePatterns = core.getInput('exclude').split(',').map(p => p.trim());

        const octokit = github.getOctokit(githubToken);
        const { context } = github;

        const eventData = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH || '', 'utf8'));
        const repo = context.repo;

        const prNumber = eventData.pull_request ? eventData.pull_request.number : null;
        if (!prNumber) {
            core.setFailed('Pull request number not found.');
            return;
        }

        core.info(`Reviewing PR #${prNumber} in repo ${repo.owner}/${repo.repo}`);

        const prResponse = await octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: prNumber
        });
        const prDetails = {
            title: prResponse.data.title || '',
            description: prResponse.data.body || '',
        };

        const { data: diffData } = await octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: prNumber,
            mediaType: { format: 'diff' },
        });

        const parsedDiff = parseDiff(diffData);

        const filesToReview = parsedDiff.filter(file => {
            return !excludePatterns.some(pattern => minimatch(file.to, pattern));
        });

        if (filesToReview.length === 0) {
            core.info("No files to review after applying exclude patterns.");
            return;
        }

        core.info(`Files to review: ${filesToReview.map(f => f.to).join(', ')}`);

        // Get the latest commit SHA for the PR
        const latestCommitSha = prResponse.data.head.sha;

        // Retrieve existing comments for the PR
        const existingCommentsResponse = await octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: prNumber
        });
        const existingComments = existingCommentsResponse.data;

        for (const file of filesToReview) {
            if (file.to === '/dev/null') continue;

            core.info(`Reviewing file: ${file.to}`);

            for (const chunk of file.chunks) {
                const prompt = createPrompt(file, chunk, prDetails);

                core.info(`Prompt for chunk: ${prompt}`);

                const aiResponse = await getAIResponse(openaiApiKey, model, prompt);

                if (aiResponse && aiResponse.length > 0) {
                    for (const res of aiResponse) {
                        const position = findPositionInChunk(chunk, res.lineNumber);
                        if (position !== -1) {
                            const commentExists = existingComments.some(comment =>
                                comment.path === file.to &&
                                comment.position === position
                            );

                            if (!commentExists) {
                                await addReviewComment(octokit, repo.owner, repo.repo, prNumber, latestCommitSha, file.to, position, res.reviewComment);
                                core.info(`Added review comment on file ${file.to} at position ${position}`);
                            } else {
                                core.info(`Skipping comment on file ${file.to} at position ${position} (already exists).`);
                            }
                        }
                    }
                }
            }
        }

    } catch (error) {
        core.setFailed(error.message);
    }
}

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

async function addReviewComment(octokit, owner, repo, pull_number, commit_id, path, position, body) {
    try {
        await octokit.rest.pulls.createReviewComment({
            owner,
            repo,
            pull_number,
            commit_id,
            path,
            position,
            body,
        });
    } catch (error) {
        core.error(`Error while adding review comment: ${error.message}`);
    }
}

function findPositionInChunk(chunk, lineNumber) {
    for (const change of chunk.changes) {
        if (change.ln === lineNumber || change.ln2 === lineNumber) {
            return change.position; // Return the diff position for the line
        }
    }
    return -1;
}

run();
