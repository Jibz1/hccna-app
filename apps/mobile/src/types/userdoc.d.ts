export type UserDocType = {
  email: string;
  uid: string;
  firstName?: string;
  lastName?: string;
  departments?: {
    id: number | string;
    slug: string;
    ccbId: string;
    name: string;
    image: string;
    description?: string | null;
    fullName?: string | null;
    link: string;
  }[];
  ministries?: {
    id: number | string;
    slug: string;
    ccbId: string;
    name: string;
    image: string;
    description?: string | null;
    fullName?: string | null;
    link: string;
  }[];
  giving?: GivingDoc | null;
  ccbId?: string | null;
  ccbFamilyId?: string | null;
  img?: string | null;
  isVerified: boolean;
  phone?: string | null;
  userMetadata?: any | null;
  provider?: string | null;
  createdAt?: string | null;
};
