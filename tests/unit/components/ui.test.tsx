/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Pagination, SportFilterBar } from "@/components/Pagination";
import { StatusIndicator } from "@/components/StatusIndicator";
import { ToastStack } from "@/components/ToastStack";

describe("StatusIndicator", () => {
  it.each([
    ["connected", /live/i],
    ["connecting", /connecting/i],
    ["reconnecting", /reconnecting/i],
    ["disconnected", /offline/i],
  ] as const)("renders the %s state", (status, label) => {
    render(<StatusIndicator status={status} />);
    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", status);
  });

  it("exposes the status through a testable attribute", () => {
    render(<StatusIndicator status="connected" subscribers={3} />);
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
  });

  it("shows the room size only when someone is subscribed", () => {
    const { unmount } = render(<StatusIndicator status="connected" subscribers={3} />);
    expect(screen.getByText(/3 in room/i)).toBeInTheDocument();
    unmount();

    render(<StatusIndicator status="connected" subscribers={0} />);
    expect(screen.queryByText(/in room/i)).not.toBeInTheDocument();
  });

  it("shows the attempt count while reconnecting", () => {
    render(<StatusIndicator status="reconnecting" attempts={4} />);
    expect(screen.getByText("#4")).toBeInTheDocument();
  });

  it("announces politely for screen readers", () => {
    render(<StatusIndicator status="connected" />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});

describe("Pagination", () => {
  const noop = vi.fn();

  it("renders nothing when there are no items", () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} totalItems={0} onPageChange={noop} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("reports the visible range", () => {
    render(<Pagination page={2} totalPages={3} totalItems={18} onPageChange={noop} />);
    expect(screen.getByText(/showing 7–12 of 18/i)).toBeInTheDocument();
  });

  it("marks the current page for assistive technology", () => {
    render(<Pagination page={2} totalPages={3} totalItems={18} onPageChange={noop} />);
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  });

  it("disables Prev on the first page and Next on the last", () => {
    const { unmount } = render(<Pagination page={1} totalPages={3} totalItems={18} onPageChange={noop} />);
    expect(screen.getByRole("button", { name: /prev/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
    unmount();

    render(<Pagination page={3} totalPages={3} totalItems={18} onPageChange={noop} />);
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("requests the adjacent page when Next is clicked", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination page={1} totalPages={3} totalItems={18} onPageChange={onPageChange} />);

    await user.click(screen.getByRole("button", { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("renders every page when they fit", () => {
    render(<Pagination page={1} totalPages={4} totalItems={24} onPageChange={noop} />);
    for (const page of [1, 2, 3, 4]) {
      expect(screen.getByRole("button", { name: `Page ${page}` })).toBeInTheDocument();
    }
  });

  it("collapses long page ranges with ellipses", () => {
    render(<Pagination page={10} totalPages={20} totalItems={120} onPageChange={noop} />);
    expect(screen.getAllByText("…").length).toBeGreaterThan(0);
    // First and last are always reachable.
    expect(screen.getByRole("button", { name: "Page 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 20" })).toBeInTheDocument();
    // The window stays small.
    expect(screen.getAllByRole("button", { name: /^Page \d+$/ })).toHaveLength(5);
  });

  it("is wrapped in a labelled navigation landmark", () => {
    render(<Pagination page={1} totalPages={2} totalItems={12} onPageChange={noop} />);
    expect(screen.getByRole("navigation", { name: /pagination/i })).toBeInTheDocument();
  });
});

describe("SportFilterBar", () => {
  const counts = { all: 10, football: 4, cricket: 3, basketball: 3 };

  it("renders every filter with its count", () => {
    render(<SportFilterBar value="all" counts={counts} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /all sports/i })).toHaveTextContent("10");
    expect(screen.getByRole("button", { name: /football/i })).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: /cricket/i })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /basketball/i })).toHaveTextContent("3");
  });

  it("marks the active filter as pressed", () => {
    render(<SportFilterBar value="cricket" counts={counts} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /cricket/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /football/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports the chosen filter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SportFilterBar value="all" counts={counts} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /basketball/i }));
    expect(onChange).toHaveBeenCalledWith("basketball");
  });

  it("summarises the group for screen readers", () => {
    render(<SportFilterBar value="all" counts={counts} onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: /filter by sport/i })).toBeInTheDocument();
  });
});

describe("ToastStack", () => {
  it("renders nothing without toasts", () => {
    const { container } = render(<ToastStack toasts={[]} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a toast title and description", () => {
    render(
      <ToastStack
        toasts={[{ id: 1, title: "New match scheduled", description: "Arsenal 0 – 0 Chelsea", tone: "info" }]}
        onDismiss={vi.fn()}
      />
    );

    expect(screen.getByText("New match scheduled")).toBeInTheDocument();
    expect(screen.getByText("Arsenal 0 – 0 Chelsea")).toBeInTheDocument();
  });

  it("dismisses a toast by id", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <ToastStack toasts={[{ id: 7, title: "Notice", tone: "info" }]} onDismiss={onDismiss} />
    );

    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledWith(7);
  });

  it("renders error toasts with an alert affordance", () => {
    render(<ToastStack toasts={[{ id: 2, title: "Realtime notice", tone: "error" }]} onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Realtime notice");
  });
});
