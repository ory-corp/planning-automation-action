# planning-automation-action

> GitHub Action that helps automate GitHub Projects

It reacts to `issues` and `pull_request` events, and does the following:

- Sets initial label
- Adds the issue/PR to the configured project board
- Sets the status, effort and milestones

## Inputs

- `project`: Project board number (`github.com/orgs/foo/projects/N`)
- `token`: A personal access token with write:org capabilities.
- `todoLabel`: Initial label for new issues/PRs. Defaults to `needs triage`.
- `statusName`: Name of the 'status' field on the project board. Defaults to `status`.
- `prStatusValue`: Name of the 'todo' status on the project board. Defaults to `todo`.
- `issueStatusValue`: Name of the 'todo' status on the project board. Defaults to `todo`.
- `effortName`: Name of the 'effort' field on the project board `effort`.
- `effortMapping`: JSON string with map where:
  - string key is a valid 'effort' field value
  - number value is maximum duration in days
  for example: {"two days": 2, "workweek": 5}.  
  Defaults to `[{"pattern": "two days", "value": 2},{"pattern": "the longest one", "value": 1e1000}]`.  
  `1e1000` is JSON for `Infinity`
- `monthlyMilestoneName`: Name of the 'monthly milestone' field on the project board. Defaults to `monthly milestone`.
- `quarterlyMilestoneName`: Name of the 'quarterly milestone' field on the project board. Defaults to `quarterly milestone`.

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
    name: Synchronize Issues and PRs
    steps:
      - uses: ory-corp/planning-automation-action@main
        with:
          project: 9
          token: ${{ secrets.PLANNING_AUTOMATION_TOKEN }}
          todo_label: needs triage
          statusName: status
          prStatusValue: todo
          issueStatusValue: todo
          effortName: effort
          effortMapping: '{"two days": 2, "workweek": 5}'
          monthlyMilestoneName: monthly milestone
          quarterlyMilestoneName: quarterly milestone
```

## Testing

This action can be run from localhost against existing PR, repo and project to confirm that it works as intended.
Create files `.secrets` and `.env` based on sample files and adjust prData.json
Run `make test`
