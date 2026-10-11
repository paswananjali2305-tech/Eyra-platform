import { Icon } from './Icon';

export function StateBanner({ tone = 'info', title, children }) {
  const tones = {
    info: 'border-outline-variant/40 bg-surface-container-low text-on-surface-variant',
    error: 'border-error/40 bg-error-container/20 text-error',
    warn: 'border-warning/40 bg-warning/10 text-warning',
    success: 'border-tertiary/40 bg-tertiary-container/10 text-tertiary',
    empty: 'border-outline-variant/30 bg-surface-container-lowest text-outline',
  };
  return (
    <div className={`rounded-lg border px-space-md py-space-md ${tones[tone] || tones.info}`}>
      <div className="flex items-start gap-space-sm">
        <Icon
          name={tone === 'error' ? 'error' : tone === 'empty' ? 'inbox' : 'info'}
          className="text-[18px] mt-0.5"
        />
        <div>
          {title ? <div className="font-semibold text-[15px] text-on-surface mb-1">{title}</div> : null}
          <div className="text-[13px] leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}
