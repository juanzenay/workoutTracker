-- Machine notes: how to set the machine up (seat, pad and handle positions), kept with the machine
-- and shown in the logger whenever it is picked. Nullable and unset for every existing machine.

alter table public.machines add column notes text;
