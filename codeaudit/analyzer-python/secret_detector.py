"""
Hardcoded Secret & Credential Leak Detector
Scans for AWS, GitHub, Stripe, JWTs, Database connection URIs, and Private Keys.
"""
import re
import math
from typing import List, Dict, Any

SECRET_PATTERNS = [
    {
        "id": "SEC-AWS-KEY",
        "title": "Hardcoded AWS Access Key ID",
        "regex": r"(?:AKIA|ASIA|ABIA)[0-9A-Z]{16}",
        "severity": "Critical",
        "confidence": 0.99,
        "description": "Exposed AWS IAM Access Key ID. Allows programmatic API access to cloud infrastructure if corresponding secret key is obtained.",
        "suggestion": "Move credentials to AWS IAM Roles or environment variables via AWS Secrets Manager."
    },
    {
        "id": "SEC-GITHUB-TOKEN",
        "title": "Exposed GitHub Personal Access Token",
        "regex": r"(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}",
        "severity": "Critical",
        "confidence": 0.99,
        "description": "Hardcoded GitHub OAuth/Personal Access Token allows unauthorized read/write access to code repositories and workflows.",
        "suggestion": "Revoke token immediately in GitHub settings and load via GITHUB_TOKEN environment secret."
    },
    {
        "id": "SEC-STRIPE-KEY",
        "title": "Hardcoded Stripe Secret API Key",
        "regex": r"sk_(?:live|test)_[0-9a-zA-Z]{24,99}",
        "severity": "Critical",
        "confidence": 0.99,
        "description": "Stripe secret payment key committed into source code. Live keys allow unauthorized financial transactions and balance manipulation.",
        "suggestion": "Rotate key in Stripe Dashboard and access solely through process.env.STRIPE_SECRET_KEY."
    },
    {
        "id": "SEC-JWT-TOKEN",
        "title": "Hardcoded JWT Token",
        "regex": r"eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}",
        "severity": "High",
        "confidence": 0.95,
        "description": "Bearer JWT authorization token found directly in source code. Could allow unauthorized impersonation of user or service sessions.",
        "suggestion": "Obtain ephemeral tokens dynamically via OAuth/OIDC authentication handshake."
    },
    {
        "id": "SEC-DATABASE-URI",
        "title": "Database Connection String with Credentials",
        "regex": r"(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[a-zA-Z0-9_\-\.]+:[a-zA-Z0-9_\-\.]+@[a-zA-Z0-9_\-\.]+",
        "severity": "Critical",
        "confidence": 0.98,
        "description": "Database connection URI contains plaintext username and password credentials.",
        "suggestion": "Use connection string injection via DATABASE_URL environment variable."
    },
    {
        "id": "SEC-GENERIC-PASSWORD",
        "title": "Potential Hardcoded Password / Secret Assignment",
        "regex": r"(?:password|passwd|api_key|apikey|secret_key|secretKey|auth_token)\s*[:=]\s*['\"][a-zA-Z0-9!@#$%^&*()_+=-]{8,64}['\"]",
        "severity": "High",
        "confidence": 0.85,
        "description": "Variable assignment matches sensitive credential identifier with a hardcoded string literal.",
        "suggestion": "Store secrets in .env and access via environment configuration manager."
    }
]

def mask_secret(match_str: str) -> str:
    if len(match_str) <= 6:
        return "****"
    return match_str[:3] + "..." + match_str[-3:]

def scan_for_secrets(filepath: str, content: str) -> List[Dict[str, Any]]:
    # Skip test files and lockfiles for secret audits to reduce noise
    if any(skip in filepath.lower() for skip in ["package-lock.json", "yarn.lock", "poetry.lock", "pnpm-lock.yaml"]):
        return []

    issues = []
    lines = content.splitlines()

    for line_idx, line in enumerate(lines, 1):
        for pattern in SECRET_PATTERNS:
            matches = list(re.finditer(pattern["regex"], line))
            for m in matches:
                # Ignore dummy placeholders like 'password123' if it's explicitly named 'test' or 'dummy'
                secret_text = m.group(0)
                if any(mock in secret_text.lower() for mock in ["test_token", "dummy", "placeholder", "your_secret_here"]):
                    continue

                start = max(1, line_idx - 2)
                end = min(len(lines), line_idx + 2)
                snippet_lines = []
                for i in range(start, end + 1):
                    l_text = lines[i-1]
                    if i == line_idx:
                        # Mask the secret in the snippet
                        l_text = l_text.replace(secret_text, mask_secret(secret_text))
                    snippet_lines.append(f"{i}: {l_text}")

                issues.append({
                    "id": f"{pattern['id']}-{line_idx}",
                    "ruleId": pattern["id"],
                    "file": filepath,
                    "line": line_idx,
                    "column": m.start() + 1,
                    "severity": pattern["severity"],
                    "type": "Security",
                    "title": pattern["title"],
                    "description": pattern["description"],
                    "confidence": pattern["confidence"],
                    "snippet": "\n".join(snippet_lines),
                    "suggestion": pattern["suggestion"],
                    "secretMasked": mask_secret(secret_text)
                })

    return issues
