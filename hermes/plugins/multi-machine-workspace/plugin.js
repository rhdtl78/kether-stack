/**
 * Desktop-only ESM entry. Initial scaffold, not the workspace feature.
 * No network requests, session navigation or global state mutation.
 * Do not install into a live Hermes plugin directory without approval.
 */
export default {
  id: 'multi-machine-workspace',
  name: 'Multi-machine Workspace',
  defaultEnabled: false,
  register(ctx) {
    ctx.register({
      id: 'workspace',
      area: 'panes',
      title: 'Multi-machine Workspace',
      data: { placement: 'left' },
      render: () => '초기 구성 단계입니다. 머신·프로젝트·세션 조회는 아직 구현되지 않았습니다.'
    })
  }
}
