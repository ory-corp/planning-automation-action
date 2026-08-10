const assert = require('node:assert/strict');
const fs = require('node:fs');

const actionYaml = fs.readFileSync('action.yml', 'utf8');

function extractStep(name) {
    const marker = `    - name: ${name}\n`;
    const start = actionYaml.indexOf(marker);
    assert.notEqual(start, -1, `missing ${name} step`);

    const nextStep = actionYaml.indexOf('\n    - name: ', start + marker.length);
    return actionYaml.slice(start, nextStep === -1 ? undefined : nextStep);
}

function extractScript(step) {
    const marker = '        script: |\n';
    const start = step.indexOf(marker);
    assert.notEqual(start, -1, 'missing github-script body');

    const lines = step.slice(start + marker.length).split('\n');
    const scriptLines = [];
    for (const line of lines) {
        if (line.startsWith('          ')) {
            scriptLines.push(line.slice(10));
            continue;
        }
        if (line === '') {
            scriptLines.push('');
            continue;
        }
        break;
    }
    return scriptLines.join('\n');
}

const labelStep = extractStep('Initial labeling');
const projectStep = extractStep('Fetch project data');
const scriptBody = extractScript(projectStep);

assert.match(
    projectStep,
    /uses: actions\/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b # v7\.1\.0/
);
assert.doesNotMatch(projectStep, /uses: actions\/github-script@v7(?:\s|$)/);
assert.equal(scriptBody.includes('${{'), false, 'expressions must not be embedded in JavaScript');
assert.equal(labelStep.includes('inputs.token'), false, 'labeling step must not receive the privileged token');
assert.equal(projectStep.includes('PLANNING_AUTOMATION_TOKEN'), false, 'privileged token must not be copied into env');
assert.match(projectStep, /github-token: \$\{\{ inputs\.token \}\}/);

const expectedInputMappings = [
    ['PLANNING_AUTOMATION_ACTION_PATH', 'github.action_path'],
    ['PLANNING_AUTOMATION_ORGANIZATION', 'inputs.organization'],
    ['PLANNING_AUTOMATION_PROJECT', 'inputs.project'],
    ['PLANNING_AUTOMATION_STATUS_NAME', 'inputs.statusName'],
    ['PLANNING_AUTOMATION_PR_STATUS_VALUE', 'inputs.prStatusValue'],
    ['PLANNING_AUTOMATION_ISSUE_STATUS_VALUE', 'inputs.issueStatusValue'],
    ['PLANNING_AUTOMATION_INCLUDE_EFFORT', 'inputs.includeEffort'],
    ['PLANNING_AUTOMATION_EFFORT_NAME', 'inputs.effortName'],
    ['PLANNING_AUTOMATION_EFFORT_MAPPING', 'inputs.effortMapping'],
    ['PLANNING_AUTOMATION_MONTHLY_MILESTONE_NAME', 'inputs.monthlyMilestoneName'],
    ['PLANNING_AUTOMATION_QUARTERLY_MILESTONE_NAME', 'inputs.quarterlyMilestoneName'],
];

for (const [environmentName, expression] of expectedInputMappings) {
    assert.ok(
        projectStep.includes(`${environmentName}: \${{ ${expression} }}`),
        `missing environment mapping for ${expression}`
    );
}

async function executeWrapper(includeEffort) {
    const github = {name: 'github'};
    const context = {name: 'context'};
    const core = {name: 'core'};
    const environment = {
        PLANNING_AUTOMATION_ACTION_PATH: '/trusted/action',
        PLANNING_AUTOMATION_ORGANIZATION: "ory'\"`\n" + '${{ github.actor }}',
        PLANNING_AUTOMATION_PROJECT: '27',
        PLANNING_AUTOMATION_STATUS_NAME: "Sta'tus `value`\n" + '${{ inputs.token }}',
        PLANNING_AUTOMATION_PR_STATUS_VALUE: 'PR "status"',
        PLANNING_AUTOMATION_ISSUE_STATUS_VALUE: "Issue 'status'",
        PLANNING_AUTOMATION_INCLUDE_EFFORT: includeEffort,
        PLANNING_AUTOMATION_EFFORT_NAME: 'Effort `field`',
        PLANNING_AUTOMATION_EFFORT_MAPPING: '[{"pattern":"two `days`","value":2}]',
        PLANNING_AUTOMATION_MONTHLY_MILESTONE_NAME: 'Monthly\nRoadmap',
        PLANNING_AUTOMATION_QUARTERLY_MILESTONE_NAME: 'Quarterly ${{ value }}',
    };
    let receivedArguments;
    const fakeRequire = requestedPath => {
        assert.equal(requestedPath, '/trusted/action/action.js');
        return async (...args) => {
            receivedArguments = args;
        };
    };
    const run = new Function(
        'github',
        'context',
        'core',
        'require',
        'process',
        `return (async () => {\n${scriptBody}\n})()`
    );

    await run(github, context, core, fakeRequire, {env: environment});

    assert.deepEqual(receivedArguments, [
        github,
        context,
        core,
        environment.PLANNING_AUTOMATION_ORGANIZATION,
        27,
        environment.PLANNING_AUTOMATION_STATUS_NAME,
        environment.PLANNING_AUTOMATION_PR_STATUS_VALUE,
        environment.PLANNING_AUTOMATION_ISSUE_STATUS_VALUE,
        includeEffort === 'true',
        environment.PLANNING_AUTOMATION_EFFORT_NAME,
        environment.PLANNING_AUTOMATION_EFFORT_MAPPING,
        environment.PLANNING_AUTOMATION_MONTHLY_MILESTONE_NAME,
        environment.PLANNING_AUTOMATION_QUARTERLY_MILESTONE_NAME,
        environment.PLANNING_AUTOMATION_ACTION_PATH,
    ]);
}

Promise.all([executeWrapper('true'), executeWrapper('false')])
    .then(() => console.log('security regression tests passed'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
