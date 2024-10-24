# BSF AI Code Reviewer

The BSF AI Code Reviewer is an AI-powered code review system that leverages OpenAI to provide automatic feedback on code quality, following industry standards and best practices. It helps in identifying code smells, potential security risks, and adherence to coding conventions.

# Features

- Leverages OpenAI's API to automatically review pull requests.
- Delivers smart comments and recommendations for enhancing code quality and security.
- Auto approve the PR if no actionable comments are found.
- Auto resolve the comments if the code changes are made and accepted.
- Supports php, js & jsx files
- Simple setup and seamless integration with GitHub workflows.

## Setup

1. To use this GitHub Action, you need an OpenAI API key. If you don't have one, sign up for an API key
   at [OpenAI](https://beta.openai.com/signup).

2. Add the OpenAI API key as a GitHub Secret in your repository with the name `OPENAI_API_KEY`. You can find more
   information about GitHub Secrets [here](https://docs.github.com/en/actions/reference/encrypted-secrets).

3. Create a `.github/workflows/bsf-pr-review.yml` file in your repository and add the following content:

```yaml
name: BSF AI Code Reviewer

on:
  pull_request:
    types:
      - opened
      - synchronize
permissions: write-all
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repo
        uses: actions/checkout@v3

      - name: AI Code Reviewer
        uses: brainstormforce/pull-request-reviewer@master
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          JIRA_BASE_URL: ${{ secrets.JIRA_BASE_URL }}
          JIRA_USERNAME: ${{ secrets.JIRA_USERNAME }}
          JIRA_TOKEN: ${{ secrets.JIRA_TOKEN }}
          OPENAI_API_MODEL: "gpt-4o-mini"
          exclude: "**/*.json, **/*.md"