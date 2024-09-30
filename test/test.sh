#! /bin/bash
act pull_request -j test-github-script \
    -W .github/workflows/workflow.yaml \
    --env-file .env \
    --secret-file .secrets \
    -e prData.json
