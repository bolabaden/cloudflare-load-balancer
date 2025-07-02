import fs from 'fs';

const content = fs.readFileSync('test/security.test.js', 'utf8');

// Fix the test structure to have proper setup in each describe block
const fixedContent = content
  .replace(/describe\('Authentication Security', \(\) => \{\s*let security;/g, 
    'describe(\'Authentication Security\', () => {\n    let security;\n    \n    test(\'setup\', () => {\n      security = new MockSecuritySystem();\n    });')
  .replace(/describe\('Session Management', \(\) => \{/g,
    'describe(\'Session Management\', () => {\n    let security;\n    \n    test(\'setup\', () => {\n      security = new MockSecuritySystem();\n    });')
  .replace(/describe\('Rate Limiting', \(\) => \{/g,
    'describe(\'Rate Limiting\', () => {\n    let security;\n    \n    test(\'setup\', () => {\n      security = new MockSecuritySystem();\n    });')
  .replace(/describe\('Input Validation', \(\) => \{/g,
    'describe(\'Input Validation\', () => {\n    let security;\n    \n    test(\'setup\', () => {\n      security = new MockSecuritySystem();\n    });')
  .replace(/describe\('XSS Protection', \(\) => \{/g,
    'describe(\'XSS Protection\', () => {\n    let security;\n    \n    test(\'setup\', () => {\n      security = new MockSecuritySystem();\n    });')
  .replace(/describe\('SQL Injection Protection', \(\) => \{/g,
    'describe(\'SQL Injection Protection\', () => {\n    let security;\n    \n    test(\'setup\', () => {\n      security = new MockSecuritySystem();\n    });')
  .replace(/describe\('CSRF Protection', \(\) => \{/g,
    'describe(\'CSRF Protection\', () => {\n    let security;\n    \n    test(\'setup\', () => {\n      security = new MockSecuritySystem();\n    });')
  .replace(/describe\('Security Audit and Logging', \(\) => \{/g,
    'describe(\'Security Audit and Logging\', () => {\n    let security;\n    \n    test(\'setup\', () => {\n      security = new MockSecuritySystem();\n    });')
  .replace(/describe\('Security Configuration', \(\) => \{/g,
    'describe(\'Security Configuration\', () => {\n    let security;\n    \n    test(\'setup\', () => {\n      security = new MockSecuritySystem();\n    });');

fs.writeFileSync('test/security.test.js', fixedContent);
console.log('Fixed security test structure'); 