"use client";

/**
 * A submit button that asks for confirmation before letting its form submit.
 * Drop it into any `<form action={serverAction}>` in place of the submit button;
 * cancelling the prompt prevents the submission (and the server action).
 */
export default function ConfirmButton({
  message = "Are you sure? This can't be undone.",
  className,
  children
}: {
  message?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
