# actions-product-board
> GitHub Action that helps automate GitHub Projects (beta)

It reacts to `issues` and `pull_request` events, and does the following:

- Sets initial labels
- Adds the issue/PR to the configured project board
- Sets the status of the ticket to Todo

### Inputs

- `project`: Project board number (`github.com/orgs/foo/projects/N`)
- `token`: A personal access token with write:org capabilities.
- `org`: The name of your organization. Defaults to `github.repository_owner`.
- `label`: Initial label for new issues/PRs. Defaults to `needs triage`.

### Complete usage

```yaml
on:
  issues:
    types: [opened]
  pull_request:
    types: [opened]

permissions:
  issues: write
  pull-requests: write

jobs:
  automate:
    runs-on: ubuntu-latest
    name: blah
    steps:
      - uses: ory-corp/actions-product-board@master
        with:
          project: 9
          token: ${{ secrets.PAT }}
          org: ory-corp
```
