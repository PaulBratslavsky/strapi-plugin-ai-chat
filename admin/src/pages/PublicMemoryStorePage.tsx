import { useState, useMemo, useEffect } from 'react';
import {
  Main,
  Box,
  Typography,
  Table,
  Thead,
  Tbody,
  Tr,
  Td,
  Th,
  Flex,
  Button,
  Textarea,
  Modal,
  Field,
  SingleSelect,
  SingleSelectOption,
  Pagination,
  SearchForm,
  Searchbar,
} from '@strapi/design-system';
import { Pencil, Trash, ArrowLeft, Plus } from '@strapi/icons';
import { Layouts } from '@strapi/strapi/admin';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { usePublicMemories } from '../hooks/usePublicMemories';
import { PLUGIN_ID } from '../pluginId';
import type { PublicMemory } from '../utils/public-memories-api';

const PAGE_SIZE = 10;

const ActionBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: ${({ theme }) => theme.colors.neutral600};
  cursor: pointer;

  &:hover {
    background: ${({ theme }) => theme.colors.neutral200};
    color: ${({ theme }) => theme.colors.primary600};
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

const DeleteActionBtn = styled(ActionBtn)`
  &:hover {
    color: ${({ theme }) => theme.colors.danger600};
  }
`;

const WideModalContent = styled(Modal.Content)`
  max-width: 680px;
  width: 100%;
`;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface MemoryModalProps {
  memory: PublicMemory | null;
  open: boolean;
  onClose: () => void;
  onSave: (data: { content: string; category: string }, documentId?: string) => void;
}

function PublicMemoryModal({ memory, open, onClose, onSave }: MemoryModalProps) {
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const isEdit = memory !== null;

  useEffect(() => {
    if (open && memory) {
      setContent(memory.content);
      setCategory(memory.category);
    } else if (open) {
      setContent('');
      setCategory('general');
    }
  }, [open, memory]);

  const handleClose = () => {
    setContent('');
    setCategory('general');
    onClose();
  };

  const handleSave = () => {
    if (!content.trim()) return;
    onSave({ content, category }, memory?.documentId);
    handleClose();
  };

  return (
    <Modal.Root open={open} onOpenChange={(isOpen: boolean) => !isOpen && handleClose()}>
      <WideModalContent>
        <Modal.Header>
          <Modal.Title>{isEdit ? 'Edit Shared Memory' : 'Add Shared Memory'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" gap={5} width="100%">
            <Field.Root width="100%">
              <Field.Label>Content</Field.Label>
              <Textarea
                placeholder="Public knowledge for the chatbot (e.g. 'Our return policy is 30 days')"
                value={content}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContent(e.target.value)}
                style={{ width: '100%', minHeight: '120px' }}
              />
            </Field.Root>
            <Field.Root width="100%">
              <Field.Label>Category</Field.Label>
              <SingleSelect
                value={category}
                onChange={(value: string) => setCategory(value)}
              >
                <SingleSelectOption value="general">General</SingleSelectOption>
                <SingleSelectOption value="faq">FAQ</SingleSelectOption>
                <SingleSelectOption value="product">Product</SingleSelectOption>
                <SingleSelectOption value="policy">Policy</SingleSelectOption>
              </SingleSelect>
              <Field.Hint>Used to organize shared memories by topic</Field.Hint>
            </Field.Root>
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">Cancel</Button>
          </Modal.Close>
          <Button onClick={handleSave} disabled={!content.trim()}>
            {isEdit ? 'Save changes' : 'Add memory'}
          </Button>
        </Modal.Footer>
      </WideModalContent>
    </Modal.Root>
  );
}

const PublicMemoryStorePage = () => {
  const navigate = useNavigate();
  const { memories, loading, addMemory, editMemory, removeMemory } = usePublicMemories();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<PublicMemory | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return memories;
    const q = search.toLowerCase();
    return memories.filter(
      (m) => m.content.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)
    );
  }, [memories, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleOpenCreate = () => {
    setEditingMemory(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (mem: PublicMemory) => {
    setEditingMemory(mem);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditingMemory(null);
  };

  const handleSave = (data: { content: string; category: string }, documentId?: string) => {
    if (documentId) {
      editMemory(documentId, data);
    } else {
      addMemory(data);
    }
  };

  return (
    <Main>
      <Layouts.Header
        title="Shared Memory Store"
        subtitle={`${memories.length} shared memories — available to every admin in this project`}
        primaryAction={
          <Button startIcon={<Plus />} onClick={handleOpenCreate}>
            Add memory
          </Button>
        }
        navigationAction={
          <Button variant="ghost" startIcon={<ArrowLeft />} onClick={() => navigate(`/plugins/${PLUGIN_ID}`)}>
            Back to Chat
          </Button>
        }
      />
      <Layouts.Content>
        <Box paddingBottom={4}>
          <SearchForm>
            <Searchbar
              name="search"
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              onClear={() => {
                setSearch('');
                setPage(1);
              }}
              placeholder="Search shared memories..."
            >
              Search
            </Searchbar>
          </SearchForm>
        </Box>

        <Table colCount={4} rowCount={paginated.length + 1}>
          <Thead>
            <Tr>
              <Th><Typography variant="sigma">Content</Typography></Th>
              <Th><Typography variant="sigma">Category</Typography></Th>
              <Th><Typography variant="sigma">Created</Typography></Th>
              <Th><Typography variant="sigma">Actions</Typography></Th>
            </Tr>
          </Thead>
          <Tbody>
            {loading && (
              <Tr>
                <Td colSpan={4}>
                  <Box padding={4}>
                    <Typography textColor="neutral600">Loading...</Typography>
                  </Box>
                </Td>
              </Tr>
            )}
            {!loading && paginated.length === 0 && (
              <Tr>
                <Td colSpan={4}>
                  <Box padding={4}>
                    <Typography textColor="neutral500">
                      {search ? 'No shared memories match your search' : 'No public memories yet — add knowledge for your public chatbot'}
                    </Typography>
                  </Box>
                </Td>
              </Tr>
            )}
            {paginated.map((mem) => (
              <Tr key={mem.documentId}>
                <Td>
                  <Typography textColor="neutral800">{mem.content}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral600">{mem.category}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral600">{formatDate(mem.createdAt)}</Typography>
                </Td>
                <Td>
                  <Flex gap={1}>
                    <ActionBtn
                      onClick={() => handleOpenEdit(mem)}
                      aria-label="Edit memory"
                    >
                      <Pencil />
                    </ActionBtn>
                    <DeleteActionBtn
                      onClick={() => removeMemory(mem.documentId)}
                      aria-label="Delete memory"
                    >
                      <Trash />
                    </DeleteActionBtn>
                  </Flex>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>

        {pageCount > 1 && (
          <Box paddingTop={4}>
            <Flex justifyContent="center">
              <Pagination.Root pageCount={pageCount} activePage={page} onPageChange={setPage}>
                <Pagination.Links />
              </Pagination.Root>
            </Flex>
          </Box>
        )}

        <PublicMemoryModal
          memory={editingMemory}
          open={modalOpen}
          onClose={handleCloseModal}
          onSave={handleSave}
        />
      </Layouts.Content>
    </Main>
  );
};

export { PublicMemoryStorePage };
