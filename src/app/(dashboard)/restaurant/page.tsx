"use client"

import { Utensils } from "lucide-react"

import { ModulePlaceholder } from "@/components/shared/ModulePlaceholder"

export default function RestaurantPage() {
  return (
    <ModulePlaceholder
      icon={Utensils}
      title="Restaurant"
      description="Tables, courses, and kitchen routing"
      status="planned"
      planned={[
        "Table and seating management per branch",
        "Orders grouped into courses, sent to the kitchen in sequence",
        "Open tabs that settle through the normal Sales path",
      ]}
      footnote={
        <>
          Restaurant is an <strong>industry add-on</strong>, enabled per tenant
          under Billing and re-checked by the API on every request (FR-BILL-03).
          Neither the endpoints nor this screen are built yet. Orders will post
          to the shared Order entity, so restaurant revenue reports through the
          same Sales and Reports surfaces as any other trade.
        </>
      }
    />
  )
}
