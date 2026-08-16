import { prisma } from './client';

interface SeededCustomer {
  customerCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  address: string | null;
}

const CUSTOMERS: SeededCustomer[] = [
  {
    customerCode: 'CUS-0001',
    firstName: 'Leila',
    lastName: 'Farouk',
    phone: '+15550100',
    email: 'leila.farouk@example.test',
    address: '12 Harbour Road, Springfield',
  },
  {
    customerCode: 'CUS-0002',
    firstName: 'Tomas',
    lastName: 'Berg',
    phone: '+15550101',
    email: 'tomas.berg@example.test',
    address: '88 Elm Street, Springfield',
  },
  {
    customerCode: 'CUS-0003',
    firstName: 'Grace',
    lastName: 'Mwangi',
    phone: '+15550102',
    email: 'grace.mwangi@example.test',
    address: '4 Kestrel Lane, Riverton',
  },
  { customerCode: 'CUS-0004', firstName: 'Hugo', lastName: 'Lindqvist', phone: '+15550103', email: null, address: '210 Mill Avenue, Riverton' },
  { customerCode: 'CUS-0005', firstName: 'Sofia', lastName: 'Marchetti', phone: '+15550104', email: 'sofia.marchetti@example.test', address: null },
  {
    customerCode: 'CUS-0006',
    firstName: 'Yusuf',
    lastName: 'Demir',
    phone: '+15550105',
    email: 'yusuf.demir@example.test',
    address: '77 Copper Way, Springfield',
  },
  {
    customerCode: 'CUS-0007',
    firstName: 'Anika',
    lastName: 'Sharma',
    phone: '+15550106',
    email: 'anika.sharma@example.test',
    address: '5 Willow Court, Eastvale',
  },
  { customerCode: 'CUS-0008', firstName: 'Peter', lastName: 'Nowak', phone: '+15550107', email: null, address: '31 Granite Street, Eastvale' },
];

interface SeededSupplier {
  supplierCode: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
}

const SUPPLIERS: SeededSupplier[] = [
  {
    supplierCode: 'SUP-0001',
    name: 'Northwind Components',
    contactPerson: 'Elena Petrova',
    phone: '+15550200',
    email: 'sales@northwind.test',
    address: '1 Industrial Park, Riverton',
  },
  {
    supplierCode: 'SUP-0002',
    name: 'Meridian Mobile Parts',
    contactPerson: 'Samuel Adeyemi',
    phone: '+15550201',
    email: 'orders@meridianparts.test',
    address: '19 Trade Centre, Springfield',
  },
  {
    supplierCode: 'SUP-0003',
    name: 'Cobalt Accessories',
    contactPerson: 'Mei Lin',
    phone: '+15550202',
    email: 'hello@cobaltacc.test',
    address: '402 Dockside, Port Halden',
  },
  {
    supplierCode: 'SUP-0004',
    name: 'Vertex Displays',
    contactPerson: 'Ivan Horvat',
    phone: '+15550203',
    email: 'supply@vertexdisplays.test',
    address: '7 Foundry Lane, Eastvale',
  },
];

export interface SeededCustomers {
  all: { id: string }[];
  byCode: Map<string, { id: string }>;
}

export async function seedCustomers(): Promise<SeededCustomers> {
  const created = await Promise.all(
    CUSTOMERS.map((customer) =>
      prisma.customer.upsert({
        where: { customerCode: customer.customerCode },
        update: { ...customer },
        create: { ...customer },
        select: { id: true, customerCode: true },
      }),
    ),
  );

  return {
    all: created.map((customer) => ({ id: customer.id })),
    byCode: new Map(created.map((customer) => [customer.customerCode, { id: customer.id }])),
  };
}

export async function seedSuppliers(): Promise<number> {
  await Promise.all(
    SUPPLIERS.map((supplier) =>
      prisma.supplier.upsert({
        where: { supplierCode: supplier.supplierCode },
        update: { ...supplier },
        create: { ...supplier },
        select: { id: true },
      }),
    ),
  );

  return SUPPLIERS.length;
}
