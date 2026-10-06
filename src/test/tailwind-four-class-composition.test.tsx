import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

afterEach(cleanup);

describe('Tailwind 4 class composition', () => {
  it('keeps the card surface when adding a dashboard gradient', () => {
    const { getByText } = render(<Card className="bg-linear-to-r from-primary/5 to-primary/10">Gradient card</Card>);
    expect(getByText('Gradient card')).toHaveClass('bg-card', 'bg-linear-to-r', 'from-primary/5', 'to-primary/10');
    expect(cn('bg-linear-to-r', 'bg-card')).toBe('bg-linear-to-r bg-card');
  });

  it('lets the last outline style replace the earlier style', () => {
    expect(cn('outline-hidden', 'outline-none')).toBe('outline-none');
    expect(cn('outline-none', 'outline-hidden')).toBe('outline-hidden');
  });
});
