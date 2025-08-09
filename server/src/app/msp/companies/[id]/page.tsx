import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { IContact } from "server/src/interfaces/contact.interfaces";
import { getDocumentByCompanyId } from 'server/src/lib/actions/document-actions/documentActions';
import CompanyDetails from 'server/src/components/companies/CompanyDetails';
import { getContactsByCompany } from 'server/src/lib/actions/contact-actions/contactActions';
import { getCompanyById } from 'server/src/lib/actions/company-actions/companyActions';
import { notFound } from 'next/navigation';

const CompanyPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const resolvedParams = await params;
  const { id } = resolvedParams;
 
  try {
    // First check if company exists
    const company = await getCompanyById(id);
    
    if (!company) {
      return notFound();
    }

    // Fetch additional data in parallel
    const [documents, contacts] = await Promise.all([
      getDocumentByCompanyId(id),
      getContactsByCompany(id, 'all')
    ]);

    return (
      <div className="mx-auto px-4">
       <CompanyDetails company={company} documents={documents} contacts={contacts} isInDrawer={false} />
      </div>
    );
  } catch (error) {
    console.error(`Error fetching data for company with id ${id}:`, error);
    throw error; // Let Next.js error boundary handle it
  }
}

export default CompanyPage;
