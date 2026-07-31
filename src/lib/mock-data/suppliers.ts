// ---------------------------------------------------------------------------
// src/lib/mock-data/suppliers.ts
// SupplierRecord type and MOCK_SUPPLIERS seed data.
//
// categories: free-text, comma-separated. Values intentionally mirror
// MOCK_PRODUCTS category names by convention only — no enforced relationship.
// TODO: replace with a real category taxonomy when backend exists.
// ---------------------------------------------------------------------------

export type SupplierRecord = {
  id: string
  name: string
  contactPerson: string
  email: string
  phone: string
  address: string
  categories: string // comma-separated free-text
  notes: string
  isActive: boolean
}

export const MOCK_SUPPLIERS: SupplierRecord[] = [
  {
    id: "sup-001",
    name: "TechSource Ltd.",
    contactPerson: "David Lim",
    email: "david.lim@techsource.example.com",
    phone: "+1 555-1001",
    address: "100 Silicon Way, Tech City",
    categories: "Electronics, Accessories",
    notes: "Primary supplier for all electronics. Net-30 terms.",
    isActive: true,
  },
  {
    id: "sup-002",
    name: "OfficePro Supplies",
    contactPerson: "Nadia C.",
    email: "nadia.c@officepro.example.com",
    phone: "+1 555-1002",
    address: "42 Business Park, Metro City",
    categories: "Office Furniture, Stationery",
    notes: "Preferred supplier for furniture. Bulk discounts available.",
    isActive: true,
  },
  {
    id: "sup-003",
    name: "CableWorld Inc.",
    contactPerson: "Frank O.",
    email: "frank.o@cableworld.example.com",
    phone: "+1 555-1003",
    address: "7 Connector Ave, Portville",
    categories: "Accessories",
    notes: "Specialises in cables and peripherals. Fast shipping.",
    isActive: true,
  },
  {
    id: "sup-004",
    name: "ErgoFit Furniture",
    contactPerson: "Mei Zhang",
    email: "mei.z@ergofit.example.com",
    phone: "+1 555-1004",
    address: "88 Comfort Road, Designtown",
    categories: "Office Furniture",
    notes: "Ergonomic chairs and desks. Long lead times — order early.",
    isActive: true,
  },
  {
    id: "sup-005",
    name: "PaperTrail Co.",
    contactPerson: "Ivan R.",
    email: "ivan.r@papertrail.example.com",
    phone: "+1 555-1005",
    address: "15 Print Lane, Inkville",
    categories: "Stationery",
    notes: "",
    isActive: false,
  },
  {
    id: "sup-006",
    name: "GlobalTech Imports",
    contactPerson: "Aisha M.",
    email: "aisha.m@globaltech.example.com",
    phone: "+1 555-1006",
    address: "300 Import Blvd, Harbor City",
    categories: "Electronics, Accessories, Office Furniture",
    notes: "Backup supplier. Higher MOQ but competitive pricing.",
    isActive: false,
  },
]
