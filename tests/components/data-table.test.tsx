import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it } from "vitest";

import { DataTable } from "@/components/data-table";

type ModelRow = {
  latency: number;
  name: string;
  status: string;
};

const columns: ColumnDef<ModelRow>[] = [
  {
    accessorKey: "name",
    header: "Model",
  },
  {
    accessorKey: "status",
    header: "Status",
  },
  {
    accessorKey: "latency",
    header: "Latency",
  },
];

const data: ModelRow[] = [
  { latency: 220, name: "Vector Vision 70B", status: "healthy" },
  { latency: 180, name: "Nimbus Multimodal 14B", status: "degraded" },
];

describe("DataTable", () => {
  it("filters table rows", async () => {
    const user = userEvent.setup();

    render(<DataTable columns={columns} data={data} filterPlaceholder="Filter models" />);

    await user.type(screen.getByLabelText("Filter models"), "Nimbus");

    expect(screen.getByText("Nimbus Multimodal 14B")).toBeInTheDocument();
    expect(screen.queryByText("Vector Vision 70B")).not.toBeInTheDocument();
  });

  it("sorts table rows by column", async () => {
    const user = userEvent.setup();

    render(<DataTable columns={columns} data={data} enableSorting />);

    await user.click(screen.getByRole("button", { name: "Sort by Model" }));

    const rows = screen.getAllByRole("row").slice(1);
    const firstRow = rows[0];
    const secondRow = rows[1];

    if (!firstRow || !secondRow) {
      throw new Error("Expected two data rows after sorting");
    }

    expect(within(firstRow).getByText("Nimbus Multimodal 14B")).toBeInTheDocument();
    expect(within(secondRow).getByText("Vector Vision 70B")).toBeInTheDocument();
  });
});
