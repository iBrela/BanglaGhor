import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the app shell with the site brand name', () => {
  render(<App />);
  const brandElements = screen.getAllByText(/BanglaGhor/i);
  expect(brandElements.length).toBeGreaterThan(0);
});
