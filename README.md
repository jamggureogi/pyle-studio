# 신관전승 통합 편집실 (pyle-studio)

게임 「신관전승」의 자료를 보고 고치는 웹 편집실입니다.
이 저장소에는 **편집실 프로그램만** 있습니다. 게임 자료(스토리, 그림, 수치)는 비공개 저장소 `jamggureogi/pyle_claude`에 있고,
편집실은 사용자가 입력한 GitHub 토큰으로 그 저장소를 읽고 씁니다. 토큰은 브라우저(localStorage)에만 저장됩니다.

- 사이트: https://jamggureogi.github.io/pyle-studio/
- 빌드 과정 없음: 순수 HTML/CSS/JavaScript(ES 모듈)
- 로컬 테스트: `python3 tools/devserver.py <게임자료 폴더 사본>` → http://localhost:8765/?local
