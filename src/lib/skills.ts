// Alias map: canonical skill -> common variants. Used by the mock LLM parser and the heuristic scorer.
export const SKILL_ALIASES: Record<string, string[]> = {
  React: ['react', 'reactjs', 'react.js'],
  TypeScript: ['typescript', 'ts'],
  'Node.js': ['node.js', 'node', 'nodejs'],
  PostgreSQL: ['postgresql', 'postgres', 'psql', 'pg'],
  Postgres: ['postgres', 'postgresql', 'psql', 'pg'],
  'Next.js': ['next.js', 'nextjs', 'next'],
  Express: ['express', 'expressjs', 'express.js'],
  Go: ['go', 'golang'],
  Python: ['python', 'py'],
  Java: ['java', 'jvm'],
  Swift: ['swift', 'swiftui'],
  Kotlin: ['kotlin'],
  'React Native': ['react native', 'react-native', 'rn'],
  Kubernetes: ['kubernetes', 'k8s'],
  Docker: ['docker', 'containers'],
  AWS: ['aws', 'amazon web services'],
  Terraform: ['terraform', 'iac'],
  Airflow: ['airflow', 'apache airflow'],
  Feast: ['feast', 'feature store'],
  Kafka: ['kafka', 'apache kafka'],
  GraphQL: ['graphql', 'apollo'],
  Redis: ['redis'],
  Spark: ['spark', 'apache spark'],
  dbt: ['dbt', 'data build tool'],
  TensorFlow: ['tensorflow', 'tf'],
  PyTorch: ['pytorch', 'torch'],
  FastAPI: ['fastapi', 'fast api'],
  Rails: ['rails', 'ruby on rails'],
  Vue: ['vue', 'vuejs', 'vue.js'],
  SvelteKit: ['sveltekit', 'svelte'],
  Tailwind: ['tailwind', 'tailwindcss'],
  Supabase: ['supabase'],
  Playwright: ['playwright'],
  Cypress: ['cypress'],
  Jest: ['jest'],
  Expo: ['expo'],
  Dart: ['dart'],
  Flutter: ['flutter'],
  Storybook: ['storybook'],
  CSS: ['css', 'css3', 'styling'],
  Spring: ['spring', 'spring boot', 'springboot'],
  Django: ['django'],
  'C++': ['c++', 'cpp'],
  'C#': ['c#', 'csharp', '.net'],
  Rust: ['rust'],
  Scala: ['scala'],
  Prometheus: ['prometheus'],
  Grafana: ['grafana'],
  Snowflake: ['snowflake'],
  BigQuery: ['bigquery', 'google bigquery'],
  Prisma: ['prisma'],
  Stripe: ['stripe'],
  Firebase: ['firebase'],
  OpenCV: ['opencv'],
  ONNX: ['onnx'],
  MLflow: ['mlflow'],
  XGBoost: ['xgboost', 'xgb'],
  SpaCy: ['spacy'],
  Elasticsearch: ['elasticsearch', 'es'],
  RabbitMQ: ['rabbitmq'],
  Celery: ['celery'],
  DRF: ['drf', 'django rest framework'],
  ArgoCD: ['argocd', 'argo cd'],
  Helm: ['helm'],
  Envoy: ['envoy proxy', 'envoy'],
  Vault: ['hashicorp vault', 'vault'],
  'Jetpack Compose': ['jetpack compose'],
  SwiftUI: ['swiftui'],
  'Core Data': ['core data', 'coredata'],
  XCTest: ['xctest'],
  Detox: ['detox'],
  Fastlane: ['fastlane'],
  Riverpod: ['riverpod'],
  RxJS: ['rxjs'],
  NgRx: ['ngrx'],
  Angular: ['angular', 'angularjs'],
  Redux: ['redux'],
  Zustand: ['zustand'],
  Apollo: ['apollo client', 'apollo'],
  Vite: ['vite'],
  MongoDB: ['mongodb', 'mongo'],
  MySQL: ['mysql'],
  SQLite: ['sqlite'],
  Bash: ['bash', 'shell'],
  Ansible: ['ansible'],
  Jenkins: ['jenkins'],
  Pandas: ['pandas'],
  GSAP: ['gsap'],
  'Framer Motion': ['framer motion', 'framer-motion'],
  Figma: ['figma'],
  i18next: ['i18next', 'i18n'],
  D3: ['d3', 'd3.js'],
  tRPC: ['trpc'],
  Hotwire: ['hotwire'],
  Sidekiq: ['sidekiq'],
  gRPC: ['grpc'],
  OpenTelemetry: ['opentelemetry', 'otel'],
  Semgrep: ['semgrep'],
  Burp: ['burp suite', 'burpsuite'],
  OWASP: ['owasp'],
  Triton: ['triton', 'triton inference server'],
  Label: ['label studio'],
  CUPED: ['cuped'],
  'A/B testing': ['a/b testing', 'ab testing', 'experimentation'],
  Causal: ['causal inference', 'causality'],
  // soft skills
  Mentored: ['mentored', 'mentorship', 'mentoring'],
};

export const SENIORITY_WORDS: Record<string, 'junior' | 'mid' | 'senior' | 'staff'> = {
  junior: 'junior',
  entry: 'junior',
  'entry-level': 'junior',
  graduate: 'junior',
  mid: 'mid',
  'mid-level': 'mid',
  intermediate: 'mid',
  senior: 'senior',
  staff: 'staff',
  principal: 'staff',
  lead: 'staff',
  vp: 'staff',
  director: 'staff',
};

export const COUNTRIES = [
  'usa', 'united states', 'us', 'america',
  'canada', 'uk', 'united kingdom', 'england', 'britain',
  'germany', 'france', 'spain', 'portugal', 'italy', 'netherlands',
  'poland', 'ireland', 'sweden', 'denmark', 'norway', 'belgium',
  'switzerland', 'bulgaria', 'romania', 'czech', 'austria',
  'india', 'brazil', 'mexico', 'japan', 'china', 'singapore',
  'australia', 'new zealand', 'israel', 'nigeria', 'kenya', 'ghana',
  'south africa', 'pakistan', 'bangladesh', 'philippines', 'egypt',
];

export const US_CITIES = ['new york', 'nyc', 'san francisco', 'sf', 'austin', 'chicago', 'denver', 'seattle', 'boston', 'los angeles', 'la', 'miami', 'atlanta', 'boulder'];

export const DOMAINS = [
  'b2b saas', 'saas', 'consumer', 'consumer apps', 'consumer social', 'fintech', 'banking', 'payments',
  'healthcare', 'health', 'e-commerce', 'ecommerce', 'retail', 'logistics', 'freight', 'ml', 'ai',
  'machine learning', 'data', 'analytics', 'devtools', 'developer tools', 'security', 'gaming', 'edtech',
];

// Extract canonical skill names mentioned in free text (alias-aware).
export function findSkillsInText(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, 'i');
      if (re.test(lower)) {
        found.push(canonical);
        break;
      }
    }
  }
  return [...new Set(found)];
}
