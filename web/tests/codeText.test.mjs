import assert from 'assert';
import { normalizeDisplayedCode, presentSuggestedFix } from '../src/lib/codeText.js';

const scratch = `# Scratch file - edit freely, then Save (Ctrl+S)

def main():
    """Entry point."""
    print("hello from EYRA")

if __name__ == "__main__":
    main()
`;

function escapeSource(source) {
  return source.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

const decoded = normalizeDisplayedCode(escapeSource(scratch));
assert.ok(decoded.includes('print("hello from EYRA")'));
assert.ok(!decoded.includes('\\n'));

const cFile = '#include <stdio.h>\nint main() {\n  printf("hello\\n");\n}\n';
assert.strictEqual(normalizeDisplayedCode(cFile), cFile);
assert.strictEqual(normalizeDisplayedCode('printf("hello\\n");'), 'printf("hello\\n");');

const hidden = presentSuggestedFix(
  'Add a closing double quote to the string in the print statement.',
  escapeSource(scratch),
  scratch,
);
assert.strictEqual(hidden.code, '');
assert.match(hidden.summary, /already parses/);

const kept = presentSuggestedFix(
  'Check the divisor before dividing.',
  escapeSource('a = 1\nb = 0\nif b != 0:\n    print(a / b)\n'),
  'a = 1\nb = 0\nprint(a / b)\n',
);
assert.match(kept.code, /if b != 0:/);

console.log('PASS code text');
