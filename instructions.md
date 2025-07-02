# Project Overview

This project is a GitHub Action designed to automate pull request (PR) code reviews using OpenAI's GPT models. It analyzes code changes, provides feedback on potential issues, and helps maintain code quality.

# Tech Stack

- **Language:** Node.js (v20)
- **Core Libraries:**
  - `@actions/core`: For creating GitHub Actions.
  - `@actions/github`: For interacting with the GitHub API.
  - `openai`: For making requests to the OpenAI API.
  - `axios`: For making HTTP requests (e.g., to JIRA).

# Key Files

- `index.js`: The main entry point for the action. It handles inputs, sets up helpers, and orchestrates the review process.
- `AiHelper.js`: Contains all logic related to interacting with the OpenAI API. This includes generating review comments, summarizing PRs, and checking comment status.
- `GithubHelper.js`: A wrapper for the GitHub API, simplifying tasks like fetching PR data, listing files, and creating comments.
- `action.yml`: The metadata file for the GitHub Action, defining inputs, outputs, and branding.
- `workflow.yml`: An example workflow file demonstrating how to use this action.

# Coding Conventions

- **Style:** Follow the existing code style (naming conventions, indentation, etc.).
- **Error Handling:** Ensure all asynchronous operations have proper `try...catch` blocks to handle potential errors gracefully.
- **Comments:** Add JSDoc-style comments to new functions to explain their purpose, parameters, and return values.
- **Dependencies:** Minimize adding new dependencies unless absolutely necessary.

# Review Focus Areas

When reviewing PRs for this project, pay special attention to:

1.  **Prompt Engineering:** The system prompts in `AiHelper.js` are critical. Ensure they are clear, concise, and provide sufficient context for the AI to generate high-quality reviews.
2.  **API Usage:** Verify that the GitHub and OpenAI APIs are used correctly and efficiently.
3.  **Input Handling:** Ensure all action inputs from `action.yml` are handled correctly and have sensible defaults.
4.  **Security:** Since this action handles API keys and repository data, ensure no sensitive information is logged or exposed.
