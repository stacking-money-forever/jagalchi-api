export interface CareerCompetency {
  slug: string;
  label: string;
  category: 'FOUNDATION' | 'FRONTEND' | 'ENGINEERING' | 'DELIVERY';
  description: string;
  aliases: string[];
}

export const CAREER_COMPETENCIES: CareerCompetency[] = [
  {
    slug: 'javascript',
    label: 'JavaScript',
    category: 'FOUNDATION',
    description: '언어 기본기와 비동기 실행 모델을 실제 코드로 설명합니다.',
    aliases: ['javascript', 'ecmascript', '자바스크립트'],
  },
  {
    slug: 'typescript',
    label: 'TypeScript',
    category: 'FOUNDATION',
    description: '타입 모델링으로 런타임 오류와 변경 비용을 줄입니다.',
    aliases: ['typescript', '타입스크립트'],
  },
  {
    slug: 'react',
    label: 'React',
    category: 'FRONTEND',
    description: '컴포넌트와 상태를 제품 요구사항에 맞게 설계합니다.',
    aliases: ['react', 'next.js', 'nextjs', '리액트', '넥스트'],
  },
  {
    slug: 'state-management',
    label: '상태 관리',
    category: 'FRONTEND',
    description: '서버·클라이언트 상태의 책임과 동기화 전략을 설계합니다.',
    aliases: ['state management', '상태 관리', 'react query', 'tanstack query', 'redux', 'zustand'],
  },
  {
    slug: 'testing',
    label: '테스트 전략',
    category: 'ENGINEERING',
    description: '위험에 맞는 단위·통합·E2E 테스트를 설계합니다.',
    aliases: ['test', 'testing', '테스트', 'vitest', 'jest', 'playwright', 'cypress'],
  },
  {
    slug: 'web-performance',
    label: '웹 성능',
    category: 'FRONTEND',
    description: '측정 가능한 지표를 기준으로 병목을 찾고 개선합니다.',
    aliases: ['performance', '성능', 'lighthouse', 'core web vitals', '최적화'],
  },
  {
    slug: 'accessibility',
    label: '웹 접근성',
    category: 'FRONTEND',
    description: '키보드·스크린리더·명도 기준을 포함한 접근성을 구현합니다.',
    aliases: ['accessibility', 'a11y', '접근성', 'wcag'],
  },
  {
    slug: 'api-integration',
    label: 'API 통합',
    category: 'ENGINEERING',
    description: 'API 계약, 오류, 인증, 캐시와 재시도를 안정적으로 다룹니다.',
    aliases: ['api', 'rest', 'graphql', '서버 연동', '백엔드 연동'],
  },
  {
    slug: 'architecture',
    label: '프론트엔드 아키텍처',
    category: 'ENGINEERING',
    description: '도메인 경계와 의존성을 장기 변경에 유리하게 설계합니다.',
    aliases: ['architecture', '아키텍처', '설계', 'design system', '디자인 시스템'],
  },
  {
    slug: 'collaboration',
    label: '협업과 코드 리뷰',
    category: 'ENGINEERING',
    description: 'PR, 리뷰, 문서와 합의를 통해 팀 변경을 안전하게 전달합니다.',
    aliases: ['collaboration', '협업', 'code review', '코드 리뷰', 'pull request', 'pr'],
  },
  {
    slug: 'ci-cd',
    label: 'CI/CD',
    category: 'DELIVERY',
    description: '검증과 배포를 자동화해 반복 가능한 릴리스를 만듭니다.',
    aliases: ['ci/cd', 'cicd', 'continuous integration', 'github actions', '배포 자동화'],
  },
  {
    slug: 'deployment',
    label: '배포와 운영',
    category: 'DELIVERY',
    description: '서비스를 배포하고 로그·오류·성능을 관측합니다.',
    aliases: ['deployment', 'deploy', '배포', 'monitoring', 'observability', '모니터링'],
  },
];

const COMPETENCY_BY_SLUG = new Map(
  CAREER_COMPETENCIES.map((competency) => [competency.slug, competency]),
);

export function getCareerCompetency(slug: string): CareerCompetency | undefined {
  return COMPETENCY_BY_SLUG.get(slug);
}

export function normalizeCompetencySlugs(slugs: string[]): string[] {
  return [...new Set(slugs.map((slug) => slug.trim().toLowerCase()))];
}

export function detectCareerCompetencies(text: string): string[] {
  const normalized = text.toLocaleLowerCase('ko-KR');
  return CAREER_COMPETENCIES.filter((competency) =>
    competency.aliases.some((alias) => normalized.includes(alias.toLocaleLowerCase('ko-KR'))),
  ).map((competency) => competency.slug);
}
