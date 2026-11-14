# kether-stack 작업 계약

## 시작과 범위

- 개인 프로젝트 저장소다. 공용 원본 `/Users/kether/projects/home`의 README.md, AGENTS.md, docs/catalog.md, docs/connecting.md와 작업별 스킬을 직접 읽는다. 공유 원본을 이 저장소에 복제하지 않는다.
- Hermes 플러그인은 `hermes/plugins/<id>/` 아래 독립 관리한다. 폴더명과 플러그인 id를 일치시킨다.
- 현재 승인 범위는 저장소·프로젝트 초기 구성과 로컬 검증이다. 기능 구현, 앱 적용·재시작, 메시지 전송, 원격 변경은 별도 승인받는다.

## 작업 안전

- 편집 전 Git 상태와 하위 지침을 확인한다. 기존 변경과 열린 세션을 보존한다.
- 후속 구현은 공유 규칙에 따라 `~/projects/.worktrees/kether-stack/feature/<작업명>`에서 진행한다. 빈 저장소의 첫 초기 구성은 기본 checkout에 있으며 아직 commit하지 않았다. worktree는 승인된 첫 commit 이후 생성한다.
- commit·push는 요청받았을 때만 한다. .env, 인증정보, 세션 DB와 로그는 저장소에 넣지 않는다.
- Hermes 앱 소스나 다른 프로필의 설정·스킬·메모리를 수정하지 않는다. SDK 제한은 숨기거나 우회하지 않고 보고한다.
- 로컬 테스트 성공, Desktop 로딩 성공, 실제 멀티 머신 동작을 구분해 보고한다.
