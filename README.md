# BSF AI Code Reviewer

The BSF AI Code Reviewer is an AI-powered code review system that leverages OpenAI to provide automatic feedback on code quality, following industry standards and best practices. It helps in identifying code smells, potential security risks, and adherence to coding conventions.

# Features

- Leverages OpenAI's API to automatically review pull requests.
- Delivers smart comments and recommendations for enhancing code quality and security.
- Auto approve the PR if no actionable comments are found.
- Auto resolve the comments if the code changes are made and accepted.
- Supports php, js & jsx files
- Simple setup and seamless integration with GitHub workflows.

# Shortcodes

- **[BSF-PR-SUMMARY]** - This shortcode will display the summary of the PR review.

## Setup

1. To use this GitHub Action, you need an OpenAI API key. If you don't have one, sign up for an API key
   at [OpenAI](https://beta.openai.com/signup).

2. Add the OpenAI API key as a GitHub Secret in your repository with the name `OPENAI_API_KEY`. You can find more
   information about GitHub Secrets [here](https://docs.github.com/en/actions/reference/encrypted-secrets).

3. Create a `.github/workflows/bsf-pr-review.yml` file in your repository and add the following content:

```yaml
name: BSF Code Reviewer

on:
  pull_request:
    types: [opened, synchronize, edited]

permissions: write-all

jobs:
  CHECK_SHORTCODE:
    if: ${{ github.event.action == 'edited' || contains(github.event.pull_request.body, '[BSF-PR-SUMMARY]') }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v3

      - name: WRITE PR SUMMARY
        uses: brainstormforce/pull-request-reviewer@master
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ACTION_CONTEXT: 'CHECK_SHORTCODE'
          EXCLUDE_EXTENSIONS: "md, yml, lock"
          INCLUDE_EXTENSIONS: "php, js, jsx, ts, tsx, css, scss, html, json"
          EXCLUDE_PATHS: "node_modules/,vendor/"

  CODE_REVIEW:
    needs: CHECK_SHORTCODE
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v3

      - name: AI CODE REVIEW
        uses: brainstormforce/pull-request-reviewer@master
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ACTION_CONTEXT: "CODE_REVIEW"
          JIRA_BASE_URL: ${{ secrets.JIRA_BASE_URL }}
          JIRA_USERNAME: ${{ secrets.JIRA_USERNAME }}
          JIRA_TOKEN: ${{ secrets.JIRA_TOKEN }}
          EXCLUDE_EXTENSIONS: "md, yml, lock"
          INCLUDE_EXTENSIONS: "php, js, jsx, ts, tsx, css, scss, html, json"
          EXCLUDE_PATHS: "node_modules/,vendor/"
