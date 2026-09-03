---
title: Stand — 우리 악단을 위한 에이전트 편곡 스튜디오 (WebMCP) 기획 스펙
created: 2026-09-04
updated: 2026-09-04
type: spec
domain: 개발
project: WebMCP Challenge 2026
status: active
stage: decision
source: Claude Code 세션 2026-09-04 00:30 KST, 유정민 × Claude Fable 5.1. 레퍼런스 리서치(OpenAI 쇼케이스 10개 상세, Alex Nahas 인터뷰, Cloudflare WebMCP 블로그, AAIF 가이드, HN 스레드, dev.to·LinkedIn 출품 글, GitHub 챌린지 저장소 도메인별 탐색, 기존 제품 조사) 후 도출. 구현은 Codex.
tags: [개발/자동화, WebMCP, 해커톤, 음악, 편곡, 악보, 교육, 에이전트, 기획, 스펙]
aliases: [Stand 스펙, 에이전트 편곡 스튜디오, WebMCP 악보]
related:
  - "[[2026-09-03-WebMCP-챌린지-출품-히스토리-Rendezvous에서-Attune으로]]"
  - "[[2026-09-03-Dossier-문서-뭉치를-사건-보드로-WebMCP-기획-스펙]]"
  - "[[2026-09-03-Cull-에이전트-네이티브-사진-컬링-WebMCP-기획-스펙]]"
---

# Stand — 우리 악단을 위한 에이전트 편곡 스튜디오

> **한 줄.** 멜로디 8마디를 악보에 찍고 "우리 학교 밴드(플루트 2, 클라리넷, 알토색스, 트럼펫, 트롬본, 타악기), 5학년 수준으로 편곡해"라고 말하면, 내 에이전트가 페이지의 툴로 파트를 하나씩 써 넣고, 페이지는 악보를 그리고 음역·이조·난이도를 검사하고 바로 들려준다. 트럼펫이 음역을 넘으면 페이지가 거절하고 에이전트가 고친다. 두 가지 엔딩이 갈리면 에이전트는 두 버전을 **재생해서 사람에게 고르게 한다**(에이전트는 들을 수 없고 사람은 들을 수 있다). 사람은 악보 위에서 음을 직접 고치고 잠근다. 파트별 PDF·MusicXML·MIDI로 내보낸다.

## 0. 리서치 요약 (왜 여기인가)

**쇼케이스 문법.** OpenAI 예시 10개(Codex Modeling Studio·Webroom(툴 28, 쓰기 24)·Crossword Desk(쓰기 4/5)·Fieldwork//12·WanderNote·Sunday Table·Cubecade·Paperie(툴 13)·Verdant Market·Margin Editor)는 전부 "에이전트가 같은 문서 위에서 만들고, 사람이 보면서 조향". OpenAI 킥오프 안내: "채팅 사이드카가 아니라 에이전트와 사람이 같은 문서를 공유하는 협업 표면을 만들어라(Margin Editor·WanderNote가 템플릿)". "우리가 본 적 없는 것을 만들어라."

**심사위원 발언.** Alex Nahas: 읽기 툴은 평평하게 항상 노출, 내비게이션 툴은 "사이트의 시스템 프롬프트", 쓰기 툴은 사람에게 "이걸 제출할까요?"를 보여 준다. 캔버스·대시보드처럼 "사람이 주 행위자이고 에이전트가 옆에서 돕는" 앱이 WebMCP의 자리. Cloudflare: "에이전트가 내비게이션이 아니라 과업에 토큰을 쓰게". AAIF 가이드: 페이지 상태에 맞는 툴 등록, 사람과 에이전트를 같은 인터페이스에.

**포화 군집(피할 것).** 증거·승인 워크스페이스(webmcp-evidence-desk, proofrail, evidence-workspace, Countersign×2, brenych, Commons), 보안 조사(aegis, BubbleSurface, exposure-incident-zero), 커머스(Shopify 전 스토어 + 다수), 접근성 어댑터(A11yMCP, Tweaksy, akses), 창작 캔버스(pixelforge, Duet, harmonium), 플래너(House, urban, OpenPlan, choose-home), 게임(escape room, chess×2, maze), 메타 툴(forge, adapter, toolfront, ninthtool), 학습 코치(Study With Your Agent), 계산기(Tariffiq).

**빈 자리(챌린지 저장소 0건, 08-20 이후).** 악보·편곡, 요리 진행, 교실 자리 배치, 유소년 스포츠 라인업, 회고록, 그룹 여행, 가족 돌봄, 법률 디스커버리, 저널리즘, 레슨 플랜, 피트니스 코치, 스크린플레이, 슬라이드, 다이어그램.

**기존 제품 점검(편곡).** MuseScore·Flat·Noteflight는 악보 편집기이지 에이전트가 없다. AI는 오디오→악보 전사(Songscription·AnthemScore·Klangio)나 오디오 생성(Suno)이지, "내 악단 편성과 수준에 맞춰 편집 가능한 악보를 써 주는" 도구는 없다. 음악 레인에 Duet(밴드 잼)·harmonium·Fieldwork(비트)가 있지만 전부 연주·비트이고 **악보 편곡은 없다.** 사용자의 로컬 프로젝트와도 무관하다.

## 1. 누구의 문제
- 학교·교회·동호회 앙상블 지도자. 출판 편곡은 내 편성(트롬본 없음, 색스 3명)과 수준에 맞지 않아 매번 손으로 다시 쓴다. 곡 하나에 몇 시간.
- 음악 교사: 학년 수준(음역·리듬·조)에 맞는 연습곡·워크시트를 계속 만든다.
- 합창 지휘자: SATB → 3부, 남성 파트 없는 날의 임시 편곡.
- 작곡 입문자: 멜로디는 있는데 화성·성부를 못 쓴다.

## 2. 왜 WebMCP인가
1. **같은 악보를 사람 손과 에이전트가 함께 쓴다.** 사람이 음을 끌어 고치고 잠그면 에이전트는 그 마디를 건너뛴다. 채팅으로 악보를 주고받는 것과 다르다.
2. **페이지가 가진 것이 에이전트에게 없다.** 악보 렌더링, 재생, 악기별 음역표, 이조(Bb·Eb·F 악기 기보음↔실음), 난이도 규칙. 에이전트가 음역을 넘는 음을 쓰면 툴이 거절하고 이유를 준다(자기 교정 루프).
3. **에이전트는 들을 수 없다.** 두 화성 안을 페이지가 재생하고 사람이 고른다(`ask_human` + A/B 재생). 사람이 결정을 쥐는 자연스러운 이유가 있다.
4. 쇼케이스 문법 그대로: 쓰기 툴이 대부분, 결과가 화면과 소리로 즉시 드러난다.

## 3. 15초 시나리오
0:00 빈 악보에 멜로디 8마디(퍼블릭 도메인 민요 프리셋 또는 직접 클릭 입력). 0:03 채팅: "5학년 밴드용으로 편곡해. 플루트 2, 클라리넷, 알토색스, 트럼펫, 트롬본, 스네어. 쉬운 조, 쉬운 리듬." 0:05 `set_ensemble` → 6개 보표가 생긴다. 0:07 파트가 위에서부터 채워진다(`write_part` 연속 호출, 마디가 채워지는 애니메이션). 0:12 "트럼펫 12마디: 기보음 D6는 5학년 음역(C4~G5) 초과" 경고 → 에이전트가 한 옥타브 내림. 0:15 ▶ 재생. 이후 "엔딩 두 가지 중 골라 주세요" A/B 재생 → 사람 선택 → 파트별 PDF 내보내기.

## 4. 화면
- **악보 영역**(메인): 총보(모든 파트) / 파트 보기 토글. 마디 클릭·드래그로 음 수정(음높이 위아래, 길이 선택), 마디 잠금 🔒. 재생 커서. 에이전트가 쓰는 중인 마디 하이라이트.
- **편성 패널**: 악기·인원·수준(초등·중등·고등·성인), 각 악기 음역 바(현재 파트의 최고·최저음 표시, 초과 시 빨강).
- **재생 컨트롤**: 재생·정지·템포·파트 솔로/뮤트·구간 반복.
- **질문 카드**(`ask_human`): "A 버전 ▶ / B 버전 ▶ / 선택".
- **에이전트 콘솔**: 툴 목록·호출 타임라인(사람의 손 편집·잠금도 같은 줄).
- **내보내기**: 총보 PDF, 파트별 PDF(이조 기보), MusicXML, MIDI.
- **빈 상태**: 멜로디 프리셋 6곡(퍼블릭 도메인), 직접 입력, MusicXML 가져오기(사람만), "▶ 저지 모드".

## 5. 데이터 모델
```ts
type Duration = 'w'|'h'|'q'|'8'|'16'|'hd'|'qd'|'8d';  // 점음표 포함
interface Note { pitch: string /* 실음 과학적 표기, 예 'Bb4'; 'r' = 쉼표 */; dur: Duration; tie?: boolean; lyric?: string; dyn?: 'p'|'mp'|'mf'|'f'; art?: 'staccato'|'accent'|'slur-start'|'slur-end' }
interface Measure { notes: Note[]; locked?: boolean }
interface Instrument { id: string; name: string; clef: 'treble'|'bass'|'alto'|'percussion'; transposition: number /* 실음→기보음 반음, Bb 클라리넷 +2, Eb 알토색스 +9, F 호른 +7 */; range: { level: Record<'elementary'|'middle'|'high'|'adult', [string,string]> } }
interface Part { instrument: Instrument; label: string /* 'Flute 1' */; measures: Measure[]; muted?: boolean }
interface Score { title: string; key: string /* 'F' */; time: '4/4'|'3/4'|'2/4'|'6/8'; tempo: number; level: 'elementary'|'middle'|'high'|'adult'; parts: Part[]; chords?: string[] /* 마디별 코드 심볼 */; undo: Op[]; log: Activity[] }
```
악기 표(초기 16종): 플루트·오보에·Bb 클라리넷·베이스 클라리넷·알토색스·테너색스·바리톤색스·트럼펫·F 호른·트롬본·유포니엄·튜바·타악기(비음정)·바이올린·비올라·첼로·피아노·소프라노·알토·테너·베이스. 각 악기에 수준별 권장 음역과 이조값.

## 6. 페이지가 하는 계산
| 일 | 방법 |
|---|---|
| 악보 렌더링 | VexFlow(Factory/EasyScore). 총보·파트, 조표·박자·이조 기보 자동 |
| 재생 | Tone.js PolySynth 파트별 음색(간단 샘플 또는 신스), 재생 커서 동기 |
| 음역 검사 | 파트의 각 음을 악기·수준 음역표와 비교, 초과 음 목록과 옥타브/재배치 제안 반환 |
| 이조 | 실음 저장, 기보 시 transposition 적용. MusicXML 내보내기에 `<transpose>` |
| 난이도 검사 | 수준별 허용 리듬(초등: 16분음 금지 등), 조표 샤프/플랫 수, 도약 폭 |
| 화성 도우미 | 코드 심볼+멜로디에서 규칙 기반 4성 배치(성부 교차·병행 5도 회피 최소 규칙). 에이전트가 직접 써도 되고 이걸 시작점으로 써도 됨 |
| 내보내기 | MusicXML(파트별 이조 기보), MIDI(midi-writer-js), PDF(인쇄 CSS, 파트별 페이지) |

## 7. WebMCP 툴 표면 (상태별 AbortSignal 교체, 설명 500자 이하, 결과마다 `changed`·`next_step`)

**empty**: `get_score`(read) · `load_preset_melody`(write, 6곡 중 하나) · `set_ensemble`(write)

**arranging (핵심)**
- `get_score` (read): 제목·조·박자·템포·수준·파트별 마디 수·잠긴 마디·음역 경고 수·현재 재생 위치·next_step.
- `read_part` (read) `{part, from?, to?}`: 마디별 음(실음·기보음 둘 다).
- `set_ensemble` (write) `{instruments:[{instrument, count?, label?}], level}`: 보표 생성·교체(기존 파트 보존).
- `set_key` · `set_time` · `set_tempo` · `set_title` (write).
- `write_part` (write) `{part, from_measure, measures:[{notes:[...]}]}`: 잠긴 마디는 건너뛰고 보고. 음역·난이도 검사 실패 시 **거절 + 이유 + 제안**(예: "Trumpet m.12 D6 > G5(초등). 옥타브 내리거나 Flute로 옮기세요").
- `write_chords` (write) `{chords:[...]}`: 마디별 코드 심볼.
- `harmonize` (write) `{source_part, target_parts, style:'block'|'pad'|'countermelody'}`: 페이지 규칙 기반 배치 초안 생성. 에이전트가 이어서 수정.
- `transpose` (write) `{to_key | semitones, parts?}`.
- `check` (read) `{part?}`: 음역·난이도·성부 교차·병행 5도 보고.
- `play` (write) `{from?, to?, parts?, loop?}` · `stop` (write).
- `ask_human` (write, 대기) `{question, options:[{label, variant:{part, from, to, notes}}]}`: 각 옵션을 ▶로 들려주고 선택을 기다린다(120초). 선택된 변형을 적용할지는 에이전트가 후속 `write_part`로.
- `add_lyrics` · `add_dynamics` (write).
- `get_locks` (read): 사람이 잠근 마디. 잠금·해제는 사람만.
- `undo` (write) · `export_plan` (read).

**exported/published**: `get_score` · `export_plan` · `reopen`(사람 확인).

총 20개. 사람만: 멜로디 직접 입력·MusicXML 가져오기, 마디 잠금, 내보내기·인쇄, 게시.

## 8. 데모 콘텐츠
퍼블릭 도메인 멜로디 6곡(예: Ode to Joy, Amazing Grace, Arirang, Greensleeves, Twinkle, Frère Jacques) 8~16마디, 악기 음역표, 수준별 규칙. 저지 모드: 프리셋 → set_ensemble → write_part×6 → check 실패→수정 → play → ask_human A/B → export.

## 9. 아키텍처·재사용
Vite + React + TS, 정적 배포. VexFlow, Tone.js, midi-writer-js. Attune에서 복사: ToolRegistry(`webmcp.ts`), AgentConsole, e2e shim, 저지 모드 전역 자막, 영상 파이프라인. 새로: 악보 모델·렌더 브리지, 편집 인터랙션, 재생 엔진, 검사기, 이조, 내보내기.

## 10. 테스트
- 단위: 이조 변환(Bb·Eb·F 왕복), 음역 검사, 난이도 규칙, MusicXML 생성 스키마, 화성 도우미(성부 교차 없음).
- e2e(shim): load_preset_melody → set_ensemble → write_part(음역 초과 → 거절 확인) → write_part(정상) → harmonize → check → play/stop → ask_human(사람 클릭) → 사람 잠금 후 write_part가 그 마디를 건너뛰는지 → export 파일 생성.

## 11. 영상 대본 (3분 이내, 첫 15초에 소리)
0:00 타이틀 3초 → 0:03 멜로디 프리셋, 채팅 한 문장 → 0:05 보표 6개 생성 → 0:07 파트가 채워짐 → 0:12 음역 경고와 자기 교정 → 0:15 ▶ 재생(소리!) → 0:30 사람이 마디 하나 손으로 고치고 잠금, 에이전트가 존중 → 0:45 왜 WebMCP(같은 악보·페이지가 검사·에이전트는 못 듣는다) → 1:05 ask_human A/B 재생 → 1:25 파트 보기 전환, 이조 기보 → 1:40 내보내기 PDF·MusicXML → 2:00 언더 더 후드(툴 20·표면 3·이조·음역·테스트) → 2:30 끝.

## 12. 심사 4기준 답
- 왜 WebMCP: 사람과 에이전트가 같은 악보를 쓰고, 페이지가 렌더·재생·음역·이조 규칙을 갖고, 사람만 들을 수 있다.
- UX: 몇 시간의 편곡이 한 문장과 몇 번의 선택으로. 초과 음은 툴이 거절.
- 새로 가능한 것: 내 편성·내 수준에 맞는 편곡을 내 에이전트가 쓰고, 나는 들으며 고른다.
- 구현: 상태별 표면 3개·툴 20개, 거절형 검사 툴, A/B 재생 ask_human, 사람 잠금, MusicXML/MIDI/PDF.

## 13. Codex 작업 순서 (6시간 MVP)
1. 스캐폴드 + Attune 재사용 + 악기표·프리셋 6곡 (40분)
2. 악보 모델 + VexFlow 렌더(총보·파트·조표·이조 기보) (70분)
3. 재생 엔진(Tone.js, 커서, 솔로/뮤트) (40분)
4. 검사기(음역·난이도·이조)와 화성 도우미 (50분)
5. 툴 표면 3개·거절 로직·ask_human A/B·콘솔·undo (60분)
6. 손 편집(음높이·길이·잠금)·내보내기(MusicXML·MIDI·PDF) (50분)
7. 저지 모드·단위+e2e·배포·README/DESCRIPTION·영상 (60분)
8. 스트레치: MIDI 키보드 입력(Web MIDI), 가사, 아티큘레이션, 샘플 음색.

## 14. 리스크
| 리스크 | 대응 |
|---|---|
| LLM이 쓴 화성이 어색 | 페이지 검사(성부 교차·병행 5도) + 규칙 기반 harmonize 초안 + 사람 A/B 선택 |
| 악보 렌더 복잡도 | 리듬 집합·박자 제한, 1~8 파트, 32마디까지 |
| "음악 앱 또 하나" 인식 | 첫 문장을 "우리 악단 편성·수준으로 편곡"으로 고정. Fieldwork/Duet은 연주·비트, 이건 교육·편곡 |
| 재생 자동 정책 | 첫 재생은 사람 클릭 후(브라우저 오디오 정책), 이후 play 툴 허용 |

## 15. 대안 (기록)
- **Care Circle — 가족 돌봄 보드.** 형제자매 각자의 에이전트가 한 페이지에서 복약·진료·방문·비용을 정리. 임팩트 최상, 챌린지 빈 자리, 그러나 Caring Village(AI 비서 Julia)·CareSplit 등 기존 앱 존재 → "에이전트 네이티브·다중 에이전트"로만 차별. Rendezvous 인프라 재사용 가능.
- **Cooking Conductor — 여러 요리 동시 진행 지휘.** 에이전트가 타임라인을 짜고 페이지가 타이머·음성 큐를 돌린다. 제작 가장 빠름, 임팩트 중, Sunday Table 인접.
