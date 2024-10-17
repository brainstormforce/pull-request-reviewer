const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const minimatch = require('minimatch');

async function run() {
    try {
        // Get input values from action.yml
        const githubToken = core.getInput('GITHUB_TOKEN');
        const openaiApiKey = core.getInput('OPENAI_API_KEY');
        const model = core.getInput('OPENAI_API_MODEL') || 'gpt-4o-mini';
        const excludePatterns = core.getInput('exclude').split(',').map(p => p.trim());

        const octokit = github.getOctokit(githubToken);
        const { context } = github;
        const prNumber = context.payload.pull_request.number;
        const repo = context.repo;

        core.info(`Reviewing PR #${prNumber} in repo ${repo.owner}/${repo.repo}`);

        // Get changed files in the PR
        const { data: files } = await octokit.rest.pulls.listFiles({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: prNumber
        });

        // Filter out excluded files based on the patterns
        const filesToReview = files.filter(file => {
            return !excludePatterns.some(pattern => minimatch(file.filename, pattern));
        });

        if (filesToReview.length === 0) {
            core.info("No files to review after applying exclude patterns.");
            return;
        }

        core.info(`Files to review: ${filesToReview.map(f => f.filename).join(', ')}`);

        for (const file of filesToReview) {
            const fileContent = await octokit.rest.repos.getContent({
                owner: repo.owner,
                repo: repo.repo,
                path: file.filename,
                ref: context.payload.pull_request.head.sha
            });

            const contentBuffer = Buffer.from(fileContent.data.content, 'base64');
            const content = contentBuffer.toString('utf-8');

            core.info(`Reviewing file: ${file.filename}`);

            // Send file content to OpenAI for review
            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: model,
                messages: [{ role: 'user', content: `Please review the following code:\n\n${content}` }],
                max_tokens: 500,
            }, {
                headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                    'Content-Type': 'application/json',
                },
            });

            const reviewComments = response.data.choices[0].message.content;

            // Add comment to the pull request
            await octokit.rest.issues.createComment({
                owner: repo.owner,
                repo: repo.repo,
                issue_number: prNumber,
                body: `### Review for \`${file.filename}\`\n\n${reviewComments}`
            });

            core.info(`Added review comments for file: ${file.filename}`);
        }

    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
