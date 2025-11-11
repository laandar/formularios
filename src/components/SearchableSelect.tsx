import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

type SearchableSelectProps = {
  options: readonly string[];
  value: string;
  placeholder: string;
  onChange: (nextValue: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  containerClassName?: string;
  inputClassName?: string;
};

const normalizeForSearch = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

const GAP_PX = 8;
const MIN_DROPDOWN_WIDTH_PX = 22 * 16; // 22rem assuming 16px root font size

export function SearchableSelect({
  options,
  value,
  placeholder,
  onChange,
  disabled = false,
  ariaLabel,
  containerClassName,
  inputClassName,
}: SearchableSelectProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value ?? "");
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [dropdownStyles, setDropdownStyles] = useState<{
    top: number;
    left: number;
    width: number;
  }>({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    setQuery(value ?? "");
  }, [value]);

  useEffect(() => {
    if (!isOpen) {
      setHighlightedIndex(-1);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const containerEl = containerRef.current;
      const listEl = listRef.current;

      if (
        (containerEl && containerEl.contains(target)) ||
        (listEl && listEl.contains(target))
      ) {
        return;
      }

      setIsOpen(false);
      setQuery(value ?? "");
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [value]);

  const normalizedQuery = normalizeForSearch(query);

  const filteredOptions = useMemo(() => {
    if (normalizedQuery.length === 0) {
      return [...options];
    }

    return options.filter((option) =>
      normalizeForSearch(option).includes(normalizedQuery)
    );
  }, [options, normalizedQuery]);

  const handleSelect = (option: string) => {
    onChange(option);
    setIsOpen(false);
    setQuery(option);
  };

  const handleInputFocus = () => {
    if (disabled) {
      return;
    }
    setIsOpen(true);
    setHighlightedIndex(0);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextQuery = event.target.value;
    setQuery(nextQuery);
    if (!isOpen) {
      setIsOpen(true);
    }
    setHighlightedIndex(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setIsOpen(true);
      setHighlightedIndex(0);
      event.preventDefault();
      return;
    }

    if (!isOpen) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) => {
        const next = current + 1;
        if (next >= filteredOptions.length) {
          return filteredOptions.length > 0 ? 0 : -1;
        }
        return next;
      });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => {
        const next = current - 1;
        if (next < 0) {
          return filteredOptions.length > 0
            ? filteredOptions.length - 1
            : -1;
        }
        return next;
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        handleSelect(filteredOptions[highlightedIndex]);
      } else if (filteredOptions.length === 1) {
        handleSelect(filteredOptions[0]);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      setQuery(value ?? "");
    }
  };

  const handleOptionMouseEnter = (index: number) => {
    setHighlightedIndex(index);
  };

  const handleBlur = () => {
    if (disabled) {
      return;
    }
    setIsOpen(false);
    setQuery(value ?? "");
  };

  const recalculateDropdownPosition = useCallback(() => {
    if (!isOpen || !triggerRef.current || !listRef.current) {
      return;
    }

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = listRef.current.offsetHeight;
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    const viewportTop = scrollY;
    const viewportWidth = scrollX + window.innerWidth;

    const width = Math.max(triggerRect.width, MIN_DROPDOWN_WIDTH_PX);

    let top = triggerRect.top + scrollY - dropdownHeight - GAP_PX;
    if (top < viewportTop + GAP_PX) {
      top = triggerRect.bottom + scrollY + GAP_PX;
    }

    let left = triggerRect.left + scrollX;
    if (left + width > viewportWidth - GAP_PX) {
      left = Math.max(
        GAP_PX + scrollX,
        viewportWidth - width - GAP_PX
      );
    }

    setDropdownStyles({ top, left, width });
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    recalculateDropdownPosition();
  }, [isOpen, recalculateDropdownPosition, filteredOptions.length, query]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleWindowUpdate = () => {
      recalculateDropdownPosition();
    };

    window.addEventListener("resize", handleWindowUpdate);
    window.addEventListener("scroll", handleWindowUpdate, true);

    return () => {
      window.removeEventListener("resize", handleWindowUpdate);
      window.removeEventListener("scroll", handleWindowUpdate, true);
    };
  }, [isOpen, recalculateDropdownPosition]);

  return (
    <div
      className={`searchable-select ${containerClassName ?? ""}`.trim()}
      ref={containerRef}
    >
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        onFocus={handleInputFocus}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        readOnly={disabled}
        className={inputClassName}
        ref={triggerRef}
      />
      {isOpen &&
        !disabled &&
        createPortal(
          <ul
            ref={listRef}
            className="searchable-select__list"
            role="listbox"
            id={listId}
            style={{
              top: `${dropdownStyles.top}px`,
              left: `${dropdownStyles.left}px`,
              width: `${dropdownStyles.width}px`,
            }}
          >
            {filteredOptions.length === 0 ? (
              <li className="searchable-select__empty">Sin coincidencias</li>
            ) : (
              filteredOptions.map((option, index) => (
                <li key={option}>
                  <button
                    type="button"
                    role="option"
                    className={`searchable-select__option ${
                      index === highlightedIndex
                        ? "searchable-select__option--active"
                        : ""
                    }`.trim()}
                    aria-selected={option === value}
                    onMouseEnter={() => handleOptionMouseEnter(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelect(option)}
                  >
                    {option}
                  </button>
                </li>
              ))
            )}
          </ul>,
          document.body
        )}
    </div>
  );
}

