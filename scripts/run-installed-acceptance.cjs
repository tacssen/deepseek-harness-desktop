const fs = require('node:fs')
const path = require('node:path')

const port = Number(process.argv[2])
const workspace = process.argv[3]
if (!Number.isInteger(port) || !workspace) {
  throw new Error('usage: node run-installed-acceptance.cjs <port> <workspace>')
}

async function rpc(method, payload) {
  const response = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `${method}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      method,
      payload,
    }),
  })
  const envelope = await response.json()
  if (!envelope?.result?.ok) {
    throw new Error(`${method}: ${JSON.stringify(envelope?.result?.error)}`)
  }
  return envelope.result.value
}

async function waitForTurn(sessionId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const history = await rpc('session.history', { sessionId, maxMessages: 60 })
    const end = history.events.find(entry => entry.event?.type === 'turn/end')
    if (end) return { history, reason: end.event.data?.reason?.kind }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('turn timeout')
}

function textMessages(history) {
  const values = []
  for (const entry of history.events) {
    if (entry.event?.type !== 'assistant/message') continue
    const content = entry.event.data?.message?.content ?? entry.event.data?.content ?? []
    for (const part of content) if (part?.type === 'text') values.push(part.text)
  }
  return values
}

async function runTask(workspaceId, prompt) {
  const created = await rpc('session.create', { workspaceId })
  const models = await rpc('session.models', { sessionId: created.sessionId })
  if (!models.routable) throw new Error('model route is not routable')
  await rpc('session.prompt', {
    sessionId: created.sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: prompt }],
  })
  const settled = await waitForTurn(created.sessionId)
  return { sessionId: created.sessionId, models, ...settled }
}

async function main() {
  fs.mkdirSync(workspace, { recursive: true })
  const inputPath = path.join(workspace, 'agent_acceptance_input.txt')
  const outputPath = path.join(workspace, 'agent_acceptance_output.txt')
  fs.writeFileSync(inputPath, 'value=before\n', 'utf8')
  fs.rmSync(outputPath, { force: true })

  const registered = await rpc('workspace.create', { path: workspace })
  const workspaceId = registered.workspace.workspaceId
  const prompt = [
    'Complete this exact multi-step acceptance task inside the current workspace only:',
    '1. Use the read tool to read agent_acceptance_input.txt and confirm it contains value=before.',
    '2. Use the write tool to create agent_acceptance_output.txt with exactly these two lines:',
    'step1=file-read-ok',
    'step2=shell-pending',
    '3. Use the pwsh tool with workdir set to the workspace to replace shell-pending with shell-ok, then read the file with PowerShell and confirm both lines.',
    '4. Use the read tool again on agent_acceptance_output.txt.',
    '5. Reply with exactly ACCEPTANCE_MULTI_OK.',
    'Do not modify any other file.',
  ].join('\n')
  const result = await runTask(workspaceId, prompt)
  const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8').replace(/\r\n/g, '\n') : ''
  const input = fs.readFileSync(inputPath, 'utf8').replace(/\r\n/g, '\n')
  const toolCalls = result.history.events
    .filter(entry => entry.event?.type === 'tool/call')
    .map(entry => entry.event.data?.name)
  const assistant = textMessages(result.history)
  const summary = {
    sessionId: result.sessionId,
    route: `${result.models.current.provider}/${result.models.current.model}`,
    turnEnd: result.reason,
    toolCalls,
    assistant,
    inputPreserved: input === 'value=before\n',
    outputExact: output === 'step1=file-read-ok\nstep2=shell-ok\n',
    output: output.trim().split('\n'),
  }
  console.log(JSON.stringify(summary, null, 2))
  if (summary.turnEnd !== 'completed' || !summary.inputPreserved || !summary.outputExact
    || !toolCalls.includes('read') || !toolCalls.includes('write') || !toolCalls.includes('pwsh')
    || !assistant.includes('ACCEPTANCE_MULTI_OK')) process.exitCode = 1
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
