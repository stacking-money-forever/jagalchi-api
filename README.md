node (서비스명: jagalchi-server-node)

주의: 폴더명 'node'는 혼동을 줄 수 있으나, 이 모듈은 Java Spring Boot 애플리케이션입니다.

개요:
- 서비스: jagalchi-server-node (Spring Boot)
- 빌드: Gradle
- 주요 포트: 8082 (로컬 개발/bootRun)

테스트 스크립트:
- tmp_send.js: STOMP/SockJS 테스트용 Node.js 클라이언트 스크립트입니다.
  - 이 스크립트는 로컬 개발에서만 사용해야 하며, 리포지토리에 커밋되지 않도록 .gitignore에 추가되어 있습니다.
  - 실행하려면 node 18+ 및 npm 패키지(@stomp/stompjs, sockjs-client)를 설치하세요.
    예: npm install @stomp/stompjs sockjs-client

실행:
- ./gradlew bootRun

컨트리뷰션 가이드:
- 코드 변경 시 기존 브랜치 규칙(Main-Feature/Semi-Feature 등)을 따르세요.
- 테스트용 스크립트는 artifacts에 포함하지 말고 필요 시 로컬에서 생성하세요.
