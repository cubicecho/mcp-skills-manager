import type { AnyFieldApi, DeepKeys, DeepValue } from '@tanstack/react-form';
import { useStore } from '@tanstack/react-form';
import type { ComponentType, ReactNode } from 'react';
import * as React from 'react';
import { FieldDescription, FieldError, FieldTitle } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

/** One choice. `description` is the line under it — what picking this one means. */
export type RadioOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode | undefined;
  /** The picture over the label, in the `card` variant. */
  icon?: ReactNode | undefined;
  /** A hover hint on the web and the accessibility hint on device. */
  hint?: string | undefined;
  disabled?: boolean | undefined;
};

/**
 * What the field needs off a form, and nothing else — structural, so a plain `useForm` binds as
 * well as the web registry's `useAppForm` does.
 */
type BindableForm = {
  state: { values: unknown };
  // Not `=> ReactNode`: TanStack types `Field` as a function component that may return a promise.
  Field: (props: never) => ReactNode | Promise<ReactNode>;
};

type ValuesOf<TForm extends BindableForm> = TForm extends { state: { values: infer TValues } } ? TValues : never;

/** The fields of `TValues` holding a string — the only ones a radio group can write. */
type StringNames<TValues> = {
  [TName in DeepKeys<TValues>]: NonNullable<DeepValue<TValues, TName>> extends string ? TName : never;
}[DeepKeys<TValues>] &
  DeepKeys<TValues>;

type Validate<TValue> = (context: { value: TValue; fieldApi: AnyFieldApi; signal: AbortSignal }) => unknown;
type Listen<TValue> = (context: { value: TValue; fieldApi: AnyFieldApi }) => void;

type RadioGroupFieldProps<TForm extends BindableForm, TName extends DeepKeys<ValuesOf<TForm>>> = {
  form: TForm;
  /** A string field of the form's values. Checked: `naem` is a type error, not an empty field. */
  name: TName;
  validators?:
    | Partial<
        Record<
          'onMount' | 'onChange' | 'onChangeAsync' | 'onBlur' | 'onBlurAsync' | 'onSubmit' | 'onSubmitAsync',
          Validate<DeepValue<ValuesOf<TForm>, TName>>
        >
      >
    | undefined;
  /** How long to wait before running the async validators, in milliseconds. */
  asyncDebounceMs?: number | undefined;
  listeners?:
    | Partial<
        Record<'onMount' | 'onUnmount' | 'onChange' | 'onBlur' | 'onSubmit', Listen<DeepValue<ValuesOf<TForm>, TName>>>
      >
    | undefined;

  options: readonly RadioOption[];
  /** The group's name, drawn as a title and pointed at by `aria-labelledby`. */
  label?: ReactNode | undefined;
  /** A line under the options, on the group as a whole. */
  description?: ReactNode | undefined;
  /** Marks the group required: an asterisk on the title and `aria-required` on the group. */
  required?: boolean | undefined;
  /** The title row's far end. */
  action?: ReactNode | undefined;
  /** Draws a placeholder where the options go, for a form whose values are still loading. */
  loading?: boolean | undefined;
  /** `row` (the default), `card` or `segmented` — see `RadioGroup`. */
  variant?: 'row' | 'card' | 'segmented' | undefined;
  /** How the options are laid out. Defaults to the variant's own. */
  orientation?: 'vertical' | 'horizontal' | undefined;
  disabled?: boolean | undefined;
  loop?: boolean | undefined;
  className?: string | undefined;
  labelClassName?: string | undefined;
  descriptionClassName?: string | undefined;
  errorClassName?: string | undefined;
  loadingClassName?: string | undefined;
  groupClassName?: string | undefined;
};

function messageOf(error: unknown): string | undefined {
  if (error == null) return undefined;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

type BodyProps = Omit<
  RadioGroupFieldProps<BindableForm, never>,
  'form' | 'name' | 'validators' | 'asyncDebounceMs' | 'listeners'
> & { field: AnyFieldApi };

function RadioGroupFieldBody({
  field,
  options,
  label,
  description,
  required = false,
  action,
  loading = false,
  variant,
  orientation,
  disabled,
  loop,
  className,
  labelClassName,
  descriptionClassName,
  errorClassName,
  loadingClassName,
  groupClassName,
}: BodyProps) {
  const uid = React.useId();
  const labelId = `${uid}-label`;
  const descriptionId = `${uid}-description`;
  const errorId = `${uid}-error`;

  const errors = useStore(field.store, (state) => state.meta.errors);
  const isTouched = useStore(field.store, (state) => state.meta.isTouched);
  const attempts = useStore(field.form.store, (state) => state.submissionAttempts);
  // Nothing is wrong until the user has chosen or tried to submit — otherwise a required group is
  // red on first paint.
  const error = isTouched || attempts > 0 ? messageOf(errors[0]) : undefined;

  const value: unknown = field.state.value;
  const describedBy = [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ');

  const title = label ? (
    <FieldTitle id={labelId} className={labelClassName}>
      {label}
      {required ? (
        <span aria-hidden className="cube-rn-text text-destructive">
          {' *'}
        </span>
      ) : null}
    </FieldTitle>
  ) : null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: React Native has no fieldset; role="group" is the cross-platform form
    <div role="group" data-slot="radio-group-field" className={cn('cube-rn-view', 'w-full min-w-0 gap-2', className)}>
      {action ? (
        <div className="cube-rn-view min-w-0 flex-row items-center gap-2">
          {title}
          <div className="cube-rn-view ml-auto shrink-0">{action}</div>
        </div>
      ) : (
        title
      )}
      {loading ? (
        <div
          aria-hidden
          data-slot="radio-group-field-skeleton"
          className={cn('cube-rn-view', 'h-16 w-full rounded-md bg-muted', loadingClassName)}
        />
      ) : (
        <RadioGroup
          value={typeof value === 'string' ? value : ''}
          onValueChange={(next) => {
            field.handleChange(next);
            // The arrow keys move focus between options, so a blur happens on the way to a
            // *different option* rather than out of the field. Choosing is what marks it touched.
            field.handleBlur();
          }}
          variant={variant}
          orientation={orientation}
          disabled={disabled}
          loop={loop}
          aria-labelledby={label ? labelId : undefined}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          className={groupClassName}
        >
          {options.map((option) => (
            <RadioGroupItem
              key={option.value}
              value={option.value}
              label={option.label}
              description={option.description}
              icon={option.icon}
              hint={option.hint}
              disabled={option.disabled}
            />
          ))}
        </RadioGroup>
      )}
      {description ? (
        <FieldDescription id={descriptionId} className={descriptionClassName}>
          {description}
        </FieldDescription>
      ) : null}
      {error ? (
        <FieldError id={errorId} className={errorClassName}>
          {error}
        </FieldError>
      ) : null}
    </div>
  );
}

/**
 * A set of exclusive choices, all of them visible, bound to a TanStack form field.
 *
 * A select hides its options behind a press, which is right for twelve of them and wrong for
 * three — a priority, a visibility, a theme reads better with the answers on the screen, and
 * better still when each can carry a line saying what it means.
 *
 * One source for both platforms. The web item used to be a `FormField` around shadcn's radix
 * group; it is now this, compiled, so the React Native app and the DOM one get the same field.
 *
 * The group is named by `aria-labelledby` pointing at a title, never by a `<label for>`: a radio
 * group is a `role="radiogroup"` box, and HTML will not let a label name one.
 *
 * ```tsx
 * <RadioGroupField
 *   form={form}
 *   name="visibility"
 *   label="Visibility"
 *   options={[
 *     { value: "private", label: "Private", description: "Only you." },
 *     { value: "team", label: "Team", description: "Everyone in the workspace." },
 *   ]}
 * />
 * ```
 */
export function RadioGroupField<TForm extends BindableForm, TName extends StringNames<ValuesOf<TForm>>>({
  form,
  name,
  validators,
  asyncDebounceMs,
  listeners,
  ...body
}: RadioGroupFieldProps<TForm, TName>) {
  // The generic `Field` cannot be described without repeating the twenty-odd type parameters
  // already correct on `form`. The cast is here, once, and `name` above is what it protects.
  const Subscribe = form.Field as ComponentType<{
    name: unknown;
    validators?: unknown | undefined;
    asyncDebounceMs?: number | undefined;
    listeners?: unknown | undefined;
    children: (field: AnyFieldApi) => ReactNode;
  }>;

  return (
    <Subscribe name={name} validators={validators} asyncDebounceMs={asyncDebounceMs} listeners={listeners}>
      {(field) => <RadioGroupFieldBody {...body} field={field} />}
    </Subscribe>
  );
}
