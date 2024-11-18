/**
 * @type {typeof import('@actions/core')}
 */
let coreGlob

/**
 * @param {import('@octokit/core').Octokit & {rest : import('@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types').RestEndpointMethods }} github
 * @param {import('@actions/github').context} context
 * @param {typeof import('@actions/core')} core
 * @param {string} organization GitHub organization name
 * @param {number} projectNumber project ID as seen in project board URL
 * @param {string} statusName status field name to be set
 * @param {string} prStatusValue PR status name to be assigned
 * @param {string} issueStatusValue Issue status name to be assigned
 * @param {Boolean} includeEffort if true, set effort
 * @param {string} effortName effort field name to be set
 * @param {string} effortMapping JSON effort name - days map
 * @param {string} monthlyMilestoneName monthly milestone field name to be set
 * @param {string} quarterlyMilestoneName quarterly milestone field name to be set
 * @param {string} basePath base action path on runner FS
 */
module.exports = async (
    github,
    context,
    core,
    organization = '',
    projectNumber,
    statusName = 'status',
    prStatusValue = 'todo',
    issueStatusValue = 'todo',
    includeEffort = true,
    effortName = 'effort',
    effortMapping = '{"two days": 2, "workweek": 5}',
    monthlyMilestoneName = 'monthly milestone',
    quarterlyMilestoneName = 'quarterly milestone',
    basePath = '.'
) => {
    coreGlob = core;
    if (typeof projectNumber !== 'number')
        bail("missing params");
    const fs = require('fs');

    // get project data
    const projectDataQuery = fs.readFileSync(`${basePath}/graphql/projectData.gql`, 'utf8');
    const projectDataParams = {
        owner: organization ? organization : context.repo.owner,
        number: projectNumber
    };
    let projectData;
    try {
        projectData = await github.graphql(projectDataQuery, projectDataParams);
    } catch (error) {
        bail(error.message);
    };
    if (!projectData.organization.projectV2.fields.nodes)
        bail("couldn't retrieve project fields");
    const projectFieldOptions = projectData.organization.projectV2.fields.nodes;
    if (!projectData.organization.projectV2.id)
        bail("couldn't retrieve project graphql id");
    const projectId = projectData.organization.projectV2.id;

    // get todo status
    let statusFieldId;
    let prStatusValueId;
    let issueStatusValueId;
    projectFieldOptions.forEach(field => {
        if (field.name === statusName) {
            statusFieldId = field.id;
            field.options.forEach(status => {
                if (status.name.toLowerCase().includes(prStatusValue.toLowerCase()))
                    prStatusValueId = status.id;
                if (status.name.toLowerCase().includes(issueStatusValue.toLowerCase()))
                    issueStatusValueId = status.id;
            });
            if (!prStatusValueId)
                bail("cannot find PR target status")
            if (!issueStatusValueId)
                bail("cannot find Issue target status")
        };
    });

    // get monthly milestone
    let monthlyMilestoneFieldId;
    let monthlyMilestoneValueId;

    projectFieldOptions.forEach(field => {
        if (field.name === monthlyMilestoneName) {
            monthlyMilestoneFieldId = field.id;
            monthlyMilestoneValueId = getCurrentIteration(field.configuration.iterations);
        };
    });

    // get quarterly milestone
    let quarterlyMilestoneFieldId;
    let quarterlyMilestoneValueId;

    projectFieldOptions.forEach(field => {
        if (field.name === quarterlyMilestoneName) {
            quarterlyMilestoneFieldId = field.id;
            quarterlyMilestoneValueId = getCurrentIteration(field.configuration.iterations);
        };
    });

    // is it a PR or an Issue
    let isPr = false;
    if (context.eventName === 'pull_request')
        isPr = true;

    // get PR / Issue id
    const prIssueId = await getPrIssueId(github, context);
    if (!prIssueId)
        bail("couldn't get ID of PR/Issue");

    // move Issue to project
    let projectItemId;
    if (!isPr) {
        const assignItemQuery = fs.readFileSync(`${basePath}/graphql/projectAssignPrIssue.gql`, 'utf8');
        const assignItemParams = {
            project: projectId,
            id: prIssueId
        };
        try {
            ({ addProjectV2ItemById: { item: { id: projectItemId } } } = await github.graphql(assignItemQuery, assignItemParams));
        } catch (error) {
            bail(error.message);
        };
    };

    let effortFieldId;
    let effortValueId;
    let effortHumanReadable;
    let isDraftPr;
    if (isPr) {
        // assign author if a PR
        const assigneeData = await github.rest.users.getByUsername({
            // not implemented in ('@actions/github').context
            // deserialized JSON from GITHUB_EVENT_PATH (/github/workflow/event.json)
            // https://docs.github.com/en/webhooks/webhook-events-and-payloads?actionType=opened#pull_request
            username: context.payload.pull_request.user.login
        });
        const assignPrToUserQuery = fs.readFileSync(`${basePath}/graphql/prAssignUser.gql`, 'utf8');
        const assignPrToUserParams = {
            assignee: assigneeData.data.node_id,
            id: prIssueId
        };
        try {
            await github.graphql(assignPrToUserQuery, assignPrToUserParams);
        } catch (error) {
            bail(error.message);
        };

        // get PR data
        const prCommitDataQuery = fs.readFileSync(`${basePath}/graphql/prCommitData.gql`, 'utf8');
        const prCommitDataParams = {
            owner: context.repo.owner,
            name: context.repo.repo,
            number: context.payload.pull_request.number
        };
        let prCommitData;
        try {
            let prAllData = await github.graphql(prCommitDataQuery, prCommitDataParams);
            prCommitData = prAllData.repository.pullRequest.commits.nodes;
            isDraftPr = prAllData.repository.pullRequest.isDraft;
        } catch (error) {
            bail(error.message);
        };

        // leave drafts alone
        if (isDraftPr) {
            coreGlob.info("detected PR draft, skipping project assignment");
            return;
        }

        // move PR to project
        const assignItemQuery = fs.readFileSync(`${basePath}/graphql/projectAssignPrIssue.gql`, 'utf8');
        const assignItemParams = {
            project: projectId,
            id: prIssueId
        };
        try {
            ({ addProjectV2ItemById: { item: { id: projectItemId } } } = await github.graphql(assignItemQuery, assignItemParams));
        } catch (error) {
            bail(error.message);
        };

        //  estimate effort if a PR
        if (includeEffort) {
            // get weekdays since PR's first commit
            let prCreatedAt = new Date();
            prCommitData.forEach(commit => {
                const commitDate = new Date(commit.commit.authoredDate);
                if (commitDate < prCreatedAt) {
                    prCreatedAt = commitDate;
                }
            });
            const workingDaysSinceCreated = countWorkingDaysSince(new Date(prCreatedAt));

            // map days spent to effort size pattern
            let milestonePattern;
            for (const [pattern, dayCount] of Object.entries(JSON.parse(effortMapping))) {
                if (workingDaysSinceCreated < dayCount) {
                    milestonePattern = pattern;
                    break;
                }
            };
            if (!milestonePattern) {
                bail("cannot estimate effort")
            }
            // select effort ID based on pattern
            projectFieldOptions.forEach(field => {
                if (field.name === effortName) {
                    effortFieldId = field.id;
                    field.options.forEach(effort => {
                        if (effort.name.toLowerCase().includes(milestonePattern.toLowerCase())) {
                            effortValueId = effort.id;
                            effortHumanReadable = effort.name;
                        };
                    });
                };
            });
        };
    };

    if (isPr) { // set status, milestones & maybe effort if a PR
        if (includeEffort) {
            const assignProjectFieldsQuery = fs.readFileSync(`${basePath}/graphql/projectEffortItemAssignFields.gql`, 'utf8');
            const assignProjectFieldsParams = {
                project: projectId,
                item: projectItemId,
                status_field: statusFieldId,
                status_value: prStatusValueId,
                effort_field: effortFieldId,
                effort_value: effortValueId,
                primary_milestone_field: monthlyMilestoneFieldId,
                primary_milestone_value: monthlyMilestoneValueId,
                secondary_milestone_field: quarterlyMilestoneFieldId,
                secondary_milestone_value: quarterlyMilestoneValueId
            };
            try {
                await github.graphql(assignProjectFieldsQuery, assignProjectFieldsParams);
            } catch (error) {
                bail(error.message);
            };
            await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.payload.pull_request.number,
                body: `Effort has been estimated to ${effortHumanReadable}.
                    This is based on date of first commit and mapping: ${effortMapping}`
            });
            coreGlob.info("set project fields including effort");
        } else {
            const assignProjectFieldsQuery = fs.readFileSync(`${basePath}/graphql/projectNoEffortItemAssignFields.gql`, 'utf8');
            const assignProjectFieldsParams = {
                project: projectId,
                item: projectItemId,
                status_field: statusFieldId,
                status_value: prStatusValueId,
                primary_milestone_field: monthlyMilestoneFieldId,
                primary_milestone_value: monthlyMilestoneValueId,
                secondary_milestone_field: quarterlyMilestoneFieldId,
                secondary_milestone_value: quarterlyMilestoneValueId
            };
            try {
                await github.graphql(assignProjectFieldsQuery, assignProjectFieldsParams);
            } catch (error) {
                bail(error.message);
            };
            coreGlob.info("set project fields omitting effort");
        }
    } else { // set status if an Issue
        const assignProjectFieldsQuery = fs.readFileSync(`${basePath}/graphql/projectIssueItemAssignFields.gql`, 'utf8');
        const assignProjectFieldsParams = {
            project: projectId,
            item: projectItemId,
            status_field: statusFieldId,
            status_value: issueStatusValueId,
        };
        try {
            await github.graphql(assignProjectFieldsQuery, assignProjectFieldsParams);
        } catch (error) {
            bail(error.message);
        };
        coreGlob.info("set project fields omitting effort & milestones");
    }
}

/**
 * @param {string} msg
 */
function bail(msg) {
    coreGlob.setFailed(msg);
    throw new Error(msg);
}

/**
 * @param {Date} startDate date to count from
 * @returns {number} number of working days since input date
 */
function countWorkingDaysSince(startDate) {
    const currentDate = new Date();
    let workingDaysCount = 0;
    startDate.setHours(0, 0, 0, 0);
    for (; startDate <= currentDate; startDate.setDate(startDate.getDate() + 1)) {
        const dayOfWeek = startDate.getDay();
        if (dayOfWeek != 0 && dayOfWeek != 6) {
            workingDaysCount++;
        };
    };
    return workingDaysCount - 1;
}

/**
 * @param {{startDate: string, duration: number, id: string}[]} iterations list of Iterations from GH API
 * @returns {string} node_id of iteration entry matching current date
 */
function getCurrentIteration(iterations) {
    let monthlyMilestoneValueId;
    iterations.forEach(iteration => {
        const now = new Date();
        const startDate = new Date(iteration.startDate);
        let endDate = new Date(iteration.startDate);
        endDate.setDate(endDate.getDate() + iteration.duration);
        if (startDate < now && now < endDate)
            monthlyMilestoneValueId = iteration.id;
    });
    return monthlyMilestoneValueId;
}

/**
 * @param {import('@octokit/core').Octokit & {rest : import('@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types').RestEndpointMethods }} github
 * @param {import('@actions/github').context} context
 * @returns {Promise<string>} node_id of PR or Issue that triggered calling workflow
 */
async function getPrIssueId(github, context) {
    if (context.payload.pull_request) {
        const apiPullRequest = await github.rest.pulls.get({
            owner: context.repo.owner,
            repo: context.repo.repo,
            pull_number: context.payload.pull_request.number
        });
        return apiPullRequest.data.node_id;
    }
    if (context.payload.issue) {
        const apiIssue = await github.rest.issues.get({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: context.payload.issue.number,
        });
        return apiIssue.data.node_id;
    }
    bail("couldn't get ID");
}
